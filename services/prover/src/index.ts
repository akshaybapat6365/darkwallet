import 'dotenv/config';

import path from 'node:path';
import crypto from 'node:crypto';

import { BlockfrostClient } from './attestation/blockfrost-client.js';
import { createOracleSigner } from './attestation/oracle-signer.js';
import { AttestationService } from './attestation/service.js';
import { loadConfig } from './config.js';
import { IntentService } from './intents/service.js';
import { ProverJobQueue } from './jobs.js';
import { PickupService, type PickupCircuits, type PickupProviders } from './midnight/pickup.js';
import { configureProviders } from './midnight/providers.js';
import { buildWalletFromSeed, createWalletAndMidnightProvider, waitForFunds, waitForSync } from './midnight/wallet.js';
import { buildServer } from './server.js';
import { createAttestationStore } from './state/attestation-store.js';
import { createAuditStore } from './state/audit-store.js';
import { createIntentStore } from './state/intent-store.js';
import { createPickupIndexStore } from './state/pickup-index.js';
import { createRelayerGasStore } from './state/relayer-gas-store.js';
import { createStateStore } from './state/store.js';
import type { PickupPrivateState } from '@midlight/pickup-contract';

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
const repoRoot = path.resolve(currentDir, '..', '..', '..');

const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const config = loadConfig(repoRoot);
const runApi = config.processRole === 'all' || config.processRole === 'api';

const walletConfig = {
  indexerHttpUrl: config.indexerHttpUrl,
  indexerWsUrl: config.indexerWsUrl,
  nodeHttpUrl: config.nodeHttpUrl,
  proofServerHttpUrl: config.proofServerHttpUrl,
};

const walletSeed = config.walletSeedHex ?? (config.network === 'standalone' ? GENESIS_MINT_WALLET_SEED : undefined);
if (!walletSeed) {
  throw new Error('MIDNIGHT_WALLET_SEED is required for non-standalone networks');
}
if (config.network !== 'standalone' && !config.oraclePrivateKeyHex) {
  throw new Error('MIDLIGHT_ORACLE_PRIVATE_KEY is required for preview/preprod/mainnet networks');
}
if (!config.oraclePrivateKeyHex) {
  // eslint-disable-next-line no-console
  console.warn('WARNING: Using insecure deterministic oracle key. For development only.');
}
if (config.network !== 'standalone' && !config.apiSecret) {
  throw new Error('MIDLIGHT_API_SECRET is required for non-standalone networks');
}
if (config.network !== 'standalone' && !config.encryptionKeyHex) {
  throw new Error('MIDLIGHT_ENCRYPTION_KEY is required for non-standalone networks');
}

const ctx = await buildWalletFromSeed(walletConfig, walletSeed);
await waitForSync(ctx.wallet);
await waitForFunds(ctx.wallet);

const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
const providers: PickupProviders = configureProviders<PickupCircuits, string, PickupPrivateState>({
  zkConfigPath: config.zkConfigPath,
  privateStateStoreName: 'midlight-private-state',
  indexerHttpUrl: config.indexerHttpUrl,
  indexerWsUrl: config.indexerWsUrl,
  proofServerHttpUrl: config.proofServerHttpUrl,
  walletAndMidnightProvider,
});

const store = await createStateStore(config);
const pickupIndex = await createPickupIndexStore(config);
const attestationStore = await createAttestationStore(config);
const intentStore = await createIntentStore(config);
const auditStore = await createAuditStore(config);
const relayerGasStore = await createRelayerGasStore(config);
await relayerGasStore.bootstrap({
  slotCount: config.relayerGasSlotCount,
  slotValueDust: config.relayerGasSlotValueDust,
});
const pickup = new PickupService({
  providers,
  store,
  pickupIndex,
  zkConfigPath: config.zkConfigPath,
  privateStateStoreName: 'midlight-private-state',
});

const jobs = new ProverJobQueue({
  redisUrl: config.redisUrl,
  pickup,
  relayerGasStore,
  mode: config.processRole,
  concurrency: config.jobConcurrency,
});
const redisStartupTimeoutMs = 15_000;
let redisStartupTimer: NodeJS.Timeout | null = null;
try {
  await Promise.race([
    jobs.start(),
    new Promise<never>((_, reject) => {
      redisStartupTimer = setTimeout(() => {
        reject(new Error(`Redis startup timeout after ${redisStartupTimeoutMs}ms. Check MIDLIGHT_REDIS_URL and Redis health.`));
      }, redisStartupTimeoutMs);
    }),
  ]);
} finally {
  if (redisStartupTimer) clearTimeout(redisStartupTimer);
}

const blockfrost = config.blockfrostProjectId
  ? new BlockfrostClient({
      network: config.network,
      projectId: config.blockfrostProjectId,
      baseUrl: config.blockfrostBaseUrl,
    })
  : null;
if (!blockfrost) {
  // eslint-disable-next-line no-console
  console.warn('WARNING: BLOCKFROST_PROJECT_ID is not configured. Attestation ownership verification is disabled.');
}
const oracleFallbackSk = crypto.createHash('sha256').update(`midlight:${config.network}:oracle:dev`).digest('hex');
const oracleSigner = await createOracleSigner({
  domainTag: config.oracleDomainTag,
  privateKeyHex: config.oraclePrivateKeyHex ?? oracleFallbackSk,
  publicKeyHex: config.oraclePublicKeyHex,
});
const attestation = new AttestationService({
  store: attestationStore,
  blockfrost,
  oracleSigner,
  config: {
    network: config.network,
    ttlMs: config.attestationTtlMs,
    maxClockSkewMs: config.attestationMaxClockSkewMs,
    proofValidityMs: config.attestationProofValidityMs,
    minL1AdaLovelace: config.minL1AdaLovelace,
  },
});
const intents = new IntentService({
  config,
  stateStore: store,
  intentStore,
  attestation,
  blockfrost,
  relayerGasStore,
});

let app: Awaited<ReturnType<typeof buildServer>> | null = null;
if (runApi) {
  app = await buildServer({
    config,
    pickup,
    jobs,
    pickupIndex,
    attestation,
    intents,
    auditStore,
  });

  await app.listen({ port: config.port, host: '127.0.0.1' });
}

const shutdown = async () => {
  await Promise.allSettled([
    app?.close() ?? Promise.resolve(),
    jobs.close(),
    store.close?.(),
    pickupIndex.close?.(),
    attestationStore.close?.(),
    intentStore.close?.(),
    auditStore.close?.(),
    relayerGasStore.close?.(),
  ]);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
