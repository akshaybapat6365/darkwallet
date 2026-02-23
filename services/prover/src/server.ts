import fs from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from 'fastify-rate-limit';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AttestationService } from './attestation/service.js';
import { createAuthPreHandler } from './auth.js';
import type { AppConfig } from './config.js';
import type { IntentService } from './intents/service.js';
import type { ProverJobQueue } from './jobs.js';
import type { PickupService } from './midnight/pickup.js';
import type { PickupIndexStore } from './state/pickup-index.js';
import type { AuditStore } from './state/audit-store.js';

const hex32 = z
  .string()
  .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'expected 32-byte hex string');

const rxIdSchema = z.union([z.string().regex(/^[0-9]+$/), z.number().int().nonnegative()]);

const registerSchema = z
  .object({
    rxId: rxIdSchema,
    pharmacyIdHex: hex32,
    patientId: z.string().uuid().optional(),
    patientPublicKeyHex: hex32.optional(),
    attestationHash: z.string().optional(),
  })
  .refine((v) => v.patientId != null || v.patientPublicKeyHex != null, {
    message: 'patientId or patientPublicKeyHex required',
    path: ['patientId'],
  });

const redeemSchema = z.object({
  patientId: z.string().uuid(),
  rxId: rxIdSchema,
  pharmacyIdHex: hex32,
  attestationHash: z.string().optional(),
});

const toErrorEnvelope = (err: unknown, requestId: string) => {
  const statusCode = Number((err as { statusCode?: number }).statusCode ?? 500);
  const message = err instanceof Error ? err.message : 'Internal server error';
  return {
    statusCode,
    message,
    requestId,
    technical: err instanceof Error && err.stack ? err.stack : undefined,
  };
};

const fail = (statusCode: number, message: string): never => {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  throw err;
};

export const buildServer = async (params: {
  config: AppConfig;
  pickup: PickupService;
  jobs: ProverJobQueue;
  pickupIndex: PickupIndexStore;
  attestation: AttestationService;
  intents: IntentService;
  auditStore: AuditStore;
}) => {
  const tlsEnabled = Boolean(params.config.tlsCertPath || params.config.tlsKeyPath);
  if (tlsEnabled && (!params.config.tlsCertPath || !params.config.tlsKeyPath)) {
    throw new Error('Both MIDLIGHT_TLS_CERT and MIDLIGHT_TLS_KEY must be set when enabling HTTPS');
  }

  const app = Fastify({
    logger: true,
    ...(tlsEnabled
      ? {
          https: {
            cert: fs.readFileSync(params.config.tlsCertPath!),
            key: fs.readFileSync(params.config.tlsKeyPath!),
          },
        }
      : {}),
  });
  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
  });
  app.addHook('preHandler', createAuthPreHandler(params.config.apiSecret));

  app.setErrorHandler((error, request, reply) => {
    const envelope = toErrorEnvelope(error, request.id);
    reply.status(envelope.statusCode).send(envelope);
  });

  app.get(
    '/api/health',
    {
      preHandler: app.rateLimit({ max: 60, timeWindow: '1 minute' }),
    },
    async () => {
      const status = await params.pickup.getStatus();
      return {
        ok: true,
        network: params.config.network,
        processRole: params.config.processRole,
        features: {
          enableIntentSigning: params.config.enableIntentSigning,
          enableAttestationEnforcement: params.config.enableAttestationEnforcement,
          allowLegacyJobEndpoints: params.config.allowLegacyJobEndpoints,
        },
        ...status,
      };
    },
  );

  app.post('/api/clinic/init', async () => {
    return await params.pickup.initClinic();
  });

  app.post('/api/patient', async () => {
    return await params.pickup.createPatient();
  });

  app.post(
    '/api/contract/deploy',
    {
      preHandler: app.rateLimit({ max: 2, timeWindow: '1 minute' }),
    },
    async () => {
      return await params.pickup.deployContract();
    },
  );

  app.post('/api/jobs/deploy', async () => {
    return await params.jobs.enqueueDeploy();
  });

  app.post('/api/jobs/register', async (req) => {
    if (params.config.enableIntentSigning && !params.config.allowLegacyJobEndpoints) {
      fail(410, 'Legacy register endpoint disabled. Use /api/v1/intents/prepare and /api/v1/intents/submit.');
    }
    const body = registerSchema.parse(req.body);
    return await params.jobs.enqueueRegister(body);
  });

  app.post('/api/jobs/redeem', async (req) => {
    if (params.config.enableIntentSigning && !params.config.allowLegacyJobEndpoints) {
      fail(410, 'Legacy redeem endpoint disabled. Use /api/v1/intents/prepare and /api/v1/intents/submit.');
    }
    const body = redeemSchema.parse(req.body);
    return await params.jobs.enqueueRedeem(body);
  });

  app.get<{ Params: { jobId: string } }>('/api/jobs/:jobId', async (req) => {
    const jobId = z.object({ jobId: z.string().min(1) }).parse(req.params).jobId;
    const job = await params.jobs.get(jobId);
    if (!job) return { job: null };
    return { job };
  });

  const attachJobSse = async (jobId: string, req: FastifyRequest, reply: FastifyReply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    const send = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const existing = await params.jobs.get(jobId);
    if (existing) {
      send({
        jobId,
        stage: existing.stage,
        progressPct: existing.progressPct,
        message: existing.logs.at(-1) ?? existing.status,
        ts: existing.updatedAt,
      });
    }

    const unsubscribe = params.jobs.onJobEvent(jobId, (payload) => {
      send(payload);
      if (payload.stage === 'CONFIRMED' || payload.stage === 'FAILED') {
        unsubscribe();
        reply.raw.end();
      }
    });

    req.raw.on('close', () => {
      unsubscribe();
    });

    return reply;
  };

  app.get<{ Params: { jobId: string } }>('/api/jobs/:jobId/events', async (req, reply) => {
    const jobId = z.object({ jobId: z.string().min(1) }).parse(req.params).jobId;
    return await attachJobSse(jobId, req, reply);
  });

  app.post('/api/contract/join', async (req) => {
    const body = z.object({ contractAddress: z.string().min(1) }).parse(req.body);
    return await params.pickup.setContractAddress(body.contractAddress);
  });

  app.get(
    '/api/contract/state',
    {
      preHandler: app.rateLimit({ max: 120, timeWindow: '1 minute' }),
    },
    async () => {
      const ledgerState = await params.pickup.getLedgerStateJson();
      return { ledgerState };
    },
  );

  app.post('/api/clinic/register', async (req) => {
    if (params.config.enableIntentSigning && !params.config.allowLegacyJobEndpoints) {
      fail(410, 'Legacy register endpoint disabled. Use /api/v1/intents/prepare and /api/v1/intents/submit.');
    }
    const body = registerSchema.parse(req.body);
    return await params.pickup.registerAuthorization(body);
  });

  app.post('/api/patient/redeem', async (req) => {
    if (params.config.enableIntentSigning && !params.config.allowLegacyJobEndpoints) {
      fail(410, 'Legacy redeem endpoint disabled. Use /api/v1/intents/prepare and /api/v1/intents/submit.');
    }
    const body = redeemSchema.parse(req.body);
    return await params.pickup.redeem(body);
  });

  app.post('/api/pharmacy/check', async (req) => {
    const body = z
      .object({
        patientId: z.string().uuid(),
        rxId: rxIdSchema,
        pharmacyIdHex: hex32,
        attestationHash: z.string().optional(),
      })
      .parse(req.body);
    return await params.pickup.check(body);
  });

  app.get<{ Querystring: { limit?: number | string } }>('/api/pickups', async (req) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(500).optional() }).parse(req.query);
    return { pickups: await params.pickupIndex.list(query.limit ?? 100) };
  });

  const challengeSchema = z.object({
    assetFingerprint: z.string().min(1),
    walletAddress: z.string().min(1).optional(),
    midnightAddress: z.string().min(1).optional(),
  });

  const verifyAttestationSchema = z.object({
    challengeId: z.string().uuid(),
    walletAddress: z.string().min(1),
    assetFingerprint: z.string().min(1),
    midnightAddress: z.string().min(1).optional(),
    signedPayloadHex: z.string().min(1),
    coseSign1Hex: z.string().min(1).optional(),
    coseKeyHex: z.string().min(1).optional(),
    signatureHex: z.string().min(1).optional(),
    keyHex: z.string().min(1).optional(),
  });

  const createChallenge = async (
    req: FastifyRequest<{ Body: z.infer<typeof challengeSchema> }>,
  ) => {
    const body = challengeSchema.parse(req.body);
    const out = await params.attestation.createChallenge({
      assetFingerprint: body.assetFingerprint,
      walletAddress: body.walletAddress ?? null,
      midnightAddress: body.midnightAddress ?? null,
    });
    await params.auditStore.record({
      requestId: req.id,
      eventType: 'attestation.challenge.created',
      payload: {
        challengeId: out.challengeId,
        assetFingerprint: body.assetFingerprint,
        walletAddress: body.walletAddress ?? null,
        midnightAddress: body.midnightAddress ?? null,
      },
      createdAt: new Date().toISOString(),
    });
    return out;
  };

  const verifyChallenge = async (
    req: FastifyRequest<{ Body: z.infer<typeof verifyAttestationSchema> }>,
  ) => {
    const body = verifyAttestationSchema.parse(req.body);
    const out = await params.attestation.verifyChallenge({
      challengeId: body.challengeId,
      walletAddress: body.walletAddress,
      midnightAddress: body.midnightAddress ?? null,
      assetFingerprint: body.assetFingerprint,
      signedPayloadHex: body.signedPayloadHex,
      coseSign1Hex: body.coseSign1Hex ?? body.signatureHex ?? fail(400, 'coseSign1Hex/signatureHex is required'),
      coseKeyHex: body.coseKeyHex ?? body.keyHex ?? fail(400, 'coseKeyHex/keyHex is required'),
    });
    await params.auditStore.record({
      requestId: req.id,
      eventType: 'attestation.challenge.verified',
      payload: {
        challengeId: body.challengeId,
        attestationHash: out.attestationHash,
        walletAddress: out.walletAddress,
      },
      createdAt: new Date().toISOString(),
    });
    return out;
  };

  app.post('/api/attestations/challenge', createChallenge);
  app.post('/api/attestations/verify', verifyChallenge);

  app.post('/api/v1/attestations/challenge', createChallenge);
  app.post('/api/v1/attestations/verify', verifyChallenge);
  app.get<{ Params: { attestationHash: string } }>('/api/v1/attestations/:attestationHash', async (req) => {
    const attestationHash = z.object({ attestationHash: z.string().min(1) }).parse(req.params).attestationHash;
    const attestation = await params.attestation.getAttestation(attestationHash);
    if (!attestation) fail(404, 'Attestation not found');
    return { attestation };
  });

  const intentPrepareSchema = z.discriminatedUnion('action', [
    z.object({
      action: z.literal('registerAuthorization'),
      body: registerSchema,
    }),
    z.object({
      action: z.literal('redeem'),
      body: redeemSchema,
    }),
  ]);

  app.post('/api/v1/intents/prepare', async (req) => {
    const body = intentPrepareSchema.parse(req.body);
    const out = await params.intents.prepareIntent(body as any);
    await params.auditStore.record({
      requestId: req.id,
      eventType: 'intent.prepared',
      payload: {
        intentId: out.intentId,
        action: body.action,
      },
      createdAt: new Date().toISOString(),
    });
    return out;
  });

  app.post('/api/v1/intents/submit', async (req) => {
    const body = z
      .object({
        intentId: z.string().uuid(),
        walletAddress: z.string().min(1),
        signedPayloadHex: z.string().min(1),
        coseSign1Hex: z.string().min(1).optional(),
        coseKeyHex: z.string().min(1).optional(),
        signatureHex: z.string().min(1).optional(),
        keyHex: z.string().min(1).optional(),
      })
      .parse(req.body);

    const submitted = await params.intents.submitIntent({
      intentId: body.intentId,
      walletAddress: body.walletAddress,
      signedPayloadHex: body.signedPayloadHex,
      coseSign1Hex: body.coseSign1Hex ?? body.signatureHex ?? fail(400, 'coseSign1Hex/signatureHex is required'),
      coseKeyHex: body.coseKeyHex ?? body.keyHex ?? fail(400, 'coseKeyHex/keyHex is required'),
    });

    const requestBody = submitted.intent.requestBody;
    let jobId = '';
    if (submitted.intent.action === 'registerAuthorization') {
      const register = registerSchema.parse(requestBody);
      const enqueued = await params.jobs.enqueueRegister({
        ...register,
        intentId: submitted.intent.intentId,
        gasSlotId: submitted.intent.gasSlotId ?? undefined,
      }, { jobId: `intent:${submitted.intent.intentId}:register` });
      jobId = enqueued.jobId;
    } else {
      const redeem = redeemSchema.parse(requestBody);
      const enqueued = await params.jobs.enqueueRedeem({
        ...redeem,
        intentId: submitted.intent.intentId,
        gasSlotId: submitted.intent.gasSlotId ?? undefined,
      }, { jobId: `intent:${submitted.intent.intentId}:redeem` });
      jobId = enqueued.jobId;
    }

    await params.auditStore.record({
      requestId: req.id,
      eventType: 'intent.submitted',
      payload: {
        intentId: submitted.intent.intentId,
        action: submitted.intent.action,
        walletAddress: submitted.walletAddress,
        jobId,
      },
      createdAt: new Date().toISOString(),
    });

    return {
      intentId: submitted.intent.intentId,
      action: submitted.intent.action,
      walletAddress: submitted.walletAddress,
      gasSlotId: submitted.intent.gasSlotId,
      jobId,
    };
  });

  app.post('/api/v1/jobs/deploy', async () => {
    return await params.jobs.enqueueDeploy();
  });

  app.post('/api/v1/jobs/register', async (req) => {
    const body = registerSchema.parse(req.body);
    return await params.jobs.enqueueRegister(body);
  });

  app.post('/api/v1/jobs/redeem', async (req) => {
    const body = redeemSchema.parse(req.body);
    return await params.jobs.enqueueRedeem(body);
  });

  app.get<{ Params: { jobId: string } }>('/api/v1/jobs/:jobId', async (req) => {
    const jobId = z.object({ jobId: z.string().min(1) }).parse(req.params).jobId;
    const job = await params.jobs.get(jobId);
    if (!job) return { job: null };
    return { job };
  });

  app.get<{ Params: { jobId: string } }>('/api/v1/jobs/:jobId/events', async (req, reply) => {
    const jobId = z.object({ jobId: z.string().min(1) }).parse(req.params).jobId;
    return await attachJobSse(jobId, req, reply);
  });

  app.get<{ Querystring: { limit?: number | string } }>('/api/v1/pickups', async (req) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(500).optional() }).parse(req.query);
    return { pickups: await params.pickupIndex.list(query.limit ?? 100) };
  });

  return app;
};
