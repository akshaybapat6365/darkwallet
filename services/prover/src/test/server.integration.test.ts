/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterAll, describe, expect, it } from 'vitest';

import type { AppConfig } from '../config.js';
import { buildServer } from '../server.js';

const config: AppConfig = {
  network: 'standalone',
  processRole: 'all',
  port: 4000,
  indexerHttpUrl: 'http://127.0.0.1:8088/api/v3/graphql',
  indexerWsUrl: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
  nodeHttpUrl: 'http://127.0.0.1:9944',
  proofServerHttpUrl: 'http://127.0.0.1:6300',
  redisUrl: 'redis://127.0.0.1:1',
  databaseUrl: undefined,
  blockfrostProjectId: undefined,
  blockfrostBaseUrl: undefined,
  attestationTtlMs: 60_000,
  attestationMaxClockSkewMs: 1_000,
  attestationProofValidityMs: 60_000,
  minL1AdaLovelace: 0n,
  enableAttestationEnforcement: false,
  enableIntentSigning: true,
  allowLegacyJobEndpoints: true,
  oraclePrivateKeyHex: undefined,
  oraclePublicKeyHex: undefined,
  oracleDomainTag: 'darkwallet:oracle:v1',
  relayerGasSlotCount: 16,
  relayerGasSlotValueDust: 5n,
  relayerGasLeaseTtlMs: 120_000,
  jobConcurrency: 1,
  apiSecret: 'test-secret',
  encryptionKeyHex: undefined,
  tlsCertPath: undefined,
  tlsKeyPath: undefined,
  walletSeedHex: undefined,
  zkConfigPath: '',
  statePath: '',
};

describe('server integration', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  afterAll(async () => {
    await app?.close();
  });

  it('returns request-id headers and health probes payload', async () => {
    app = await buildServer({
      config,
      pickup: {
        async getStatus() {
          return {
            contractAddress: null,
            clinicInitialized: false,
            patientCount: 0,
            privateStateStoreName: 'darkwallet-private-state',
          };
        },
        async initClinic() {
          return { issuerPublicKeyHex: '00'.repeat(32) };
        },
        async createPatient() {
          return { patientId: 'id', patientPublicKeyHex: '11'.repeat(32) };
        },
        async deployContract() {
          return { contractAddress: '0xabc', txId: 'tx', blockHeight: 1 };
        },
        async setContractAddress(contractAddress: string) {
          return { contractAddress };
        },
        async getLedgerStateJson() {
          return null;
        },
        async registerAuthorization() {
          return {};
        },
        async revokeAuthorization() {
          return {};
        },
        async redeem() {
          return {};
        },
        async check() {
          return {
            authorizationFound: false,
            revoked: false,
            redeemed: false,
            issuerPublicKeyHex: null,
          };
        },
      } as any,
      jobs: {
        async enqueueDeploy() {
          return { jobId: 'j1' };
        },
        async enqueueRegister() {
          return { jobId: 'j2' };
        },
        async enqueueRedeem() {
          return { jobId: 'j3' };
        },
        async get() {
          return null;
        },
        onJobEvent() {
          return () => {};
        },
      } as any,
      pickupIndex: {
        async list() {
          return [];
        },
      } as any,
      attestation: {
        async createChallenge() {
          return { challengeId: 'challenge', nonce: 'nonce', message: 'm', typedPayload: {}, payloadHex: 'aa', expiresAt: new Date().toISOString() };
        },
        async verifyChallenge() {
          return {
            attestationHash: 'att',
            verified: true,
            source: 'blockfrost',
            quantity: '1',
            walletAddress: 'addr',
            keyHashHex: 'aa'.repeat(28),
            oracleEnvelope: {
              algorithm: 'ed25519',
              domainTag: 'darkwallet:oracle:v1',
              payload: {
                cardanoAddress: 'addr',
                assetFingerprint: 'asset1',
                midnightAddress: null,
                challengeId: 'c',
                nonce: 'n',
                verifiedAt: new Date().toISOString(),
              },
              payloadHashHex: 'bb'.repeat(32),
              publicKeyHex: 'cc'.repeat(32),
              signatureHex: 'dd'.repeat(64),
            },
            expiresAt: new Date().toISOString(),
          };
        },
        async getAttestation() {
          return null;
        },
      } as any,
      intents: {
        async prepareIntent() {
          return {
            intentId: 'intent',
            nonce: 'nonce',
            issuedAt: new Date().toISOString(),
            expiresAt: new Date().toISOString(),
            typedPayload: {},
            message: 'msg',
            payloadHex: 'aa',
            payloadHashHex: 'bb',
          };
        },
        async submitIntent() {
          return {
            walletAddress: 'addr',
            intent: {
              intentId: 'intent',
              action: 'redeem',
              requestBody: {
                patientId: '00000000-0000-4000-8000-000000000000',
                rxId: '1',
                pharmacyIdHex: '11'.repeat(32),
              },
              gasSlotId: null,
            },
          };
        },
      } as any,
      auditStore: {
        async record() {},
      } as any,
    });

    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBeTruthy();

    const body = res.json();
    expect(body).toMatchObject({
      network: 'standalone',
      probes: {
        redis: expect.objectContaining({ ok: expect.any(Boolean), latencyMs: expect.any(Number) }),
        postgres: expect.objectContaining({ ok: true, mode: 'disabled' }),
        proofServer: expect.objectContaining({ ok: expect.any(Boolean), latencyMs: expect.any(Number) }),
      },
    });
  });
});
