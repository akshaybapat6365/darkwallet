import { EventEmitter } from 'node:events';

import { Job, Queue, QueueEvents, Worker } from 'bullmq';

import type { PickupService } from './midnight/pickup.js';
import type { RelayerGasStore } from './state/relayer-gas-store.js';

export type JobType = 'deployContract' | 'registerAuthorization' | 'redeem';

export type JobStage =
  | 'QUEUED'
  | 'PROOF_COMPUTING'
  | 'TX_BUILDING'
  | 'AWAITING_SIGNATURE'
  | 'RELAYING'
  | 'CONFIRMED'
  | 'FAILED';

export type JobStatus = 'running' | 'succeeded' | 'failed';

type RegisterInput = {
  rxId: string | number;
  pharmacyIdHex: string;
  patientId?: string;
  patientPublicKeyHex?: string;
  intentId?: string;
  attestationHash?: string;
  gasSlotId?: string;
};

type RedeemInput = {
  patientId: string;
  rxId: string | number;
  pharmacyIdHex: string;
  intentId?: string;
  attestationHash?: string;
  gasSlotId?: string;
};

type DeployInput = Record<string, never>;

type JobInputMap = {
  deployContract: DeployInput;
  registerAuthorization: RegisterInput;
  redeem: RedeemInput;
};

type JobResultMap = {
  deployContract: Awaited<ReturnType<PickupService['deployContract']>>;
  registerAuthorization: Awaited<ReturnType<PickupService['registerAuthorization']>>;
  redeem: Awaited<ReturnType<PickupService['redeem']>>;
};

type JobPayload = {
  type: JobType;
  input: JobInputMap[JobType];
};

type JobProgressPayload = {
  stage: JobStage;
  progressPct: number;
  message: string;
  ts: string;
};

export type JobEventPayload = JobProgressPayload & {
  jobId: string;
};

export type JobSnapshot = {
  id: string;
  type: JobType;
  status: JobStatus;
  stage: JobStage;
  progressPct: number;
  createdAt: string;
  updatedAt: string;
  logs: string[];
  result?: unknown;
  error?: { message: string };
};

const QUEUE_NAME = 'midlight-prover-jobs';

const toIso = (epochMs: number | null | undefined) => new Date(epochMs ?? Date.now()).toISOString();

const parseProgress = (raw: unknown): JobProgressPayload | null => {
  if (!raw || typeof raw !== 'object') return null;
  const maybe = raw as Record<string, unknown>;
  const stage = maybe.stage;
  const progressPct = maybe.progressPct;
  const message = maybe.message;
  const ts = maybe.ts;

  if (
    typeof stage === 'string' &&
    typeof progressPct === 'number' &&
    typeof message === 'string' &&
    typeof ts === 'string'
  ) {
    return { stage: stage as JobStage, progressPct, message, ts };
  }
  return null;
};

export class ProverJobQueue {
  readonly #queue: Queue<JobPayload, unknown, JobType>;
  readonly #worker: Worker<JobPayload, unknown, JobType> | null;
  readonly #events: QueueEvents;
  readonly #pickup: PickupService | null;
  readonly #relayerGasStore: RelayerGasStore | null;
  readonly #emitter = new EventEmitter();

  constructor(params: {
    redisUrl: string;
    pickup?: PickupService;
    relayerGasStore?: RelayerGasStore;
    mode: 'all' | 'api' | 'worker';
    concurrency: number;
  }) {
    this.#pickup = params.pickup ?? null;
    this.#relayerGasStore = params.relayerGasStore ?? null;
    const connection = parseRedisConnection(params.redisUrl);

    this.#queue = new Queue<JobPayload, unknown, JobType>(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 200,
        attempts: 2,
        backoff: { type: 'exponential', delay: 2_000 },
      },
    });

    this.#events = new QueueEvents(QUEUE_NAME, {
      connection,
    });

    this.#worker =
      params.mode === 'api'
        ? null
        : new Worker<JobPayload, unknown, JobType>(
            QUEUE_NAME,
            async (job) => {
              switch (job.name) {
                case 'deployContract':
                  return await this.#processDeploy(job as Job<JobPayload, JobResultMap['deployContract'], JobType>);
                case 'registerAuthorization':
                  return await this.#processRegister(job as Job<JobPayload, JobResultMap['registerAuthorization'], JobType>);
                case 'redeem':
                  return await this.#processRedeem(job as Job<JobPayload, JobResultMap['redeem'], JobType>);
                default:
                  throw new Error(`Unknown job type: ${job.name}`);
              }
            },
            {
              connection,
              concurrency: params.concurrency,
            },
          );

    this.#events.on('progress', ({ jobId, data }) => {
      const progress = parseProgress(data);
      if (!progress || !jobId) return;
      this.#emitter.emit(jobId, { jobId, ...progress } satisfies JobEventPayload);
    });

    this.#events.on('failed', ({ jobId, failedReason }) => {
      if (!jobId) return;
      const payload: JobEventPayload = {
        jobId,
        stage: 'FAILED',
        progressPct: 100,
        message: failedReason ?? 'Job failed',
        ts: new Date().toISOString(),
      };
      this.#emitter.emit(jobId, payload);
    });
  }

  async start(): Promise<void> {
    await this.#queue.waitUntilReady();
    await this.#events.waitUntilReady();
    if (this.#worker) {
      await this.#worker.waitUntilReady();
    }
  }

  async close(): Promise<void> {
    if (this.#worker) {
      await this.#worker.close();
    }
    await this.#events.close();
    await this.#queue.close();
  }

  onJobEvent(jobId: string, cb: (payload: JobEventPayload) => void): () => void {
    this.#emitter.on(jobId, cb);
    return () => {
      this.#emitter.off(jobId, cb);
    };
  }

  async enqueueDeploy(): Promise<{ jobId: string }> {
    const job = await this.#queue.add(
      'deployContract',
      {
        type: 'deployContract',
        input: {},
      },
      { priority: 1 },
    );
    await this.#emitQueued(job.id!);
    return { jobId: job.id! };
  }

  async enqueueRegister(input: RegisterInput, options?: { jobId?: string }): Promise<{ jobId: string }> {
    const job = await this.#queue.add(
      'registerAuthorization',
      {
        type: 'registerAuthorization',
        input,
      },
      { priority: 2, jobId: options?.jobId },
    );
    await this.#emitQueued(job.id!);
    return { jobId: job.id! };
  }

  async enqueueRedeem(input: RedeemInput, options?: { jobId?: string }): Promise<{ jobId: string }> {
    const job = await this.#queue.add(
      'redeem',
      {
        type: 'redeem',
        input,
      },
      { priority: 3, jobId: options?.jobId },
    );
    await this.#emitQueued(job.id!);
    return { jobId: job.id! };
  }

  async get(jobId: string): Promise<JobSnapshot | null> {
    const job = await this.#queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const logsOut = await this.#queue.getJobLogs(jobId, 0, 100);
    const progress = parseProgress(job.progress);

    const status: JobStatus = state === 'completed' ? 'succeeded' : state === 'failed' ? 'failed' : 'running';
    const fallbackStage: JobStage = status === 'succeeded' ? 'CONFIRMED' : status === 'failed' ? 'FAILED' : 'QUEUED';

    return {
      id: job.id!,
      type: job.name,
      status,
      stage: progress?.stage ?? fallbackStage,
      progressPct: progress?.progressPct ?? (status === 'running' ? 5 : 100),
      createdAt: toIso(job.timestamp),
      updatedAt: toIso(job.finishedOn ?? job.processedOn ?? job.timestamp),
      logs: logsOut.logs,
      result: job.returnvalue ?? undefined,
      error: job.failedReason ? { message: job.failedReason } : undefined,
    };
  }

  async #emitQueued(jobId: string): Promise<void> {
    const payload: JobEventPayload = {
      jobId,
      stage: 'QUEUED',
      progressPct: 1,
      message: 'Queued',
      ts: new Date().toISOString(),
    };
    this.#emitter.emit(jobId, payload);
  }

  async #processDeploy(job: Job<JobPayload, JobResultMap['deployContract'], JobType>) {
    if (!this.#pickup) throw new Error('Job queue worker missing pickup service');
    await this.#stage(job, 'TX_BUILDING', 20, 'Preparing deployment transaction');
    await this.#stage(job, 'RELAYING', 65, 'Submitting deployment transaction');
    const out = await this.#pickup.deployContract();
    await this.#stage(job, 'CONFIRMED', 100, `Contract deployed at ${out.contractAddress}`);
    return out;
  }

  async #processRegister(job: Job<JobPayload, JobResultMap['registerAuthorization'], JobType>) {
    if (!this.#pickup) throw new Error('Job queue worker missing pickup service');
    const input = job.data.input as RegisterInput;
    try {
      if (input.intentId) {
        await this.#stage(job, 'AWAITING_SIGNATURE', 12, `Intent ${input.intentId} signature verified`);
      }
      await this.#stage(job, 'PROOF_COMPUTING', 25, 'Computing proof and commitment');
      await this.#stage(job, 'TX_BUILDING', 55, 'Building register transaction');
      await this.#stage(job, 'RELAYING', 80, 'Relaying register transaction');
      const out = await this.#pickup.registerAuthorization(input);
      await this.#stage(job, 'CONFIRMED', 100, `Authorization committed at block ${out.blockHeight}`);
      return out;
    } finally {
      await this.#releaseGasSlot(input.gasSlotId);
    }
  }

  async #processRedeem(job: Job<JobPayload, JobResultMap['redeem'], JobType>) {
    if (!this.#pickup) throw new Error('Job queue worker missing pickup service');
    const input = job.data.input as RedeemInput;
    try {
      if (input.intentId) {
        await this.#stage(job, 'AWAITING_SIGNATURE', 12, `Intent ${input.intentId} signature verified`);
      }
      await this.#stage(job, 'PROOF_COMPUTING', 25, 'Computing redeem proof');
      await this.#stage(job, 'TX_BUILDING', 55, 'Building redeem transaction');
      await this.#stage(job, 'RELAYING', 80, 'Relaying redeem transaction');
      const out = await this.#pickup.redeem(input);
      await this.#stage(job, 'CONFIRMED', 100, `Redeem confirmed at block ${out.blockHeight}`);
      return out;
    } finally {
      await this.#releaseGasSlot(input.gasSlotId);
    }
  }

  async #stage(job: Job, stage: JobStage, progressPct: number, message: string) {
    const payload: JobProgressPayload = {
      stage,
      progressPct,
      message,
      ts: new Date().toISOString(),
    };
    await job.log(`[${stage}] ${message}`);
    await job.updateProgress(payload);
    this.#emitter.emit(job.id!, { jobId: job.id!, ...payload } satisfies JobEventPayload);
  }

  async #releaseGasSlot(gasSlotId?: string) {
    if (!gasSlotId || !this.#relayerGasStore) return;
    try {
      await this.#relayerGasStore.release({ slotId: gasSlotId });
    } catch {
      // Slot release failures should not mask transaction results; lease TTL auto-recovers.
    }
  }
}

const parseRedisConnection = (redisUrl: string) => {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname ? Number(parsed.pathname.replace('/', '') || 0) : 0,
  };
};
