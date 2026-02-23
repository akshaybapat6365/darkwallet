import path from 'node:path';

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { logger } from './logger.js';

export type Network = 'standalone' | 'preview' | 'preprod' | 'mainnet';

export type AppConfig = {
  network: Network;
  processRole: 'all' | 'api' | 'worker';
  port: number;
  indexerHttpUrl: string;
  indexerWsUrl: string;
  nodeHttpUrl: string;
  proofServerHttpUrl: string;
  redisUrl: string;
  databaseUrl?: string;
  blockfrostProjectId?: string;
  blockfrostBaseUrl?: string;
  attestationTtlMs: number;
  attestationMaxClockSkewMs: number;
  attestationProofValidityMs: number;
  minL1AdaLovelace: bigint;
  enableAttestationEnforcement: boolean;
  enableIntentSigning: boolean;
  allowLegacyJobEndpoints: boolean;
  oraclePrivateKeyHex?: string;
  oraclePublicKeyHex?: string;
  oracleDomainTag: string;
  relayerGasSlotCount: number;
  relayerGasSlotValueDust: bigint;
  relayerGasLeaseTtlMs: number;
  jobConcurrency: number;
  apiSecret?: string;
  encryptionKeyHex?: string;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  walletSeedHex?: string;
  zkConfigPath: string;
  statePath: string;
};

const requireValue = (value: string | undefined, name: string) => {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const requireUrl = (value: string | undefined, name: string) => {
  const out = requireValue(value, name);
  try {
    new URL(out);
  } catch {
    throw new Error(`Invalid URL for ${name}: ${out}`);
  }
  return out;
};

const parseBool = (raw: string | undefined, fallback: boolean): boolean => {
  if (raw == null || raw.trim() === '') return fallback;
  const v = raw.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
};

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const out = Number(raw);
  return Number.isFinite(out) && out > 0 ? Math.floor(out) : fallback;
};

const parsePositiveBigInt = (raw: string | undefined, fallback: bigint): bigint => {
  if (!raw) return fallback;
  try {
    const parsed = BigInt(raw);
    return parsed > 0n ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const parseNetwork = (raw: string | undefined): Network => {
  const v = (raw ?? 'standalone').toLowerCase();
  if (v === 'standalone' || v === 'preview' || v === 'preprod' || v === 'mainnet') return v;
  throw new Error(`Invalid MIDNIGHT_NETWORK: ${raw}`);
};

const parseProcessRole = (raw: string | undefined): 'all' | 'api' | 'worker' => {
  const v = (raw ?? 'all').toLowerCase();
  if (v === 'all' || v === 'api' || v === 'worker') return v;
  throw new Error(`Invalid MIDLIGHT_PROCESS_ROLE / DARKWALLET_PROCESS_ROLE: ${raw}`);
};

const parsePort = (raw: string | undefined): number => {
  if (!raw) return 4000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
};

const normalizeHexKey = (raw: string | undefined, envName: string): string | undefined => {
  if (!raw) return undefined;
  const clean = raw.trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`${envName} must be a 32-byte hex string`);
  }
  return clean;
};

const readCompatEnv = (legacyName: string, modernName: string): string | undefined => {
  const modernValue = process.env[modernName];
  if (modernValue != null && modernValue.trim() !== '') return modernValue;

  const legacyValue = process.env[legacyName];
  if (legacyValue != null && legacyValue.trim() !== '') {
    logger.warn({ legacyName, modernName }, 'Legacy environment variable is deprecated');
    return legacyValue;
  }

  return undefined;
};

export const loadConfig = (repoRoot: string): AppConfig => {
  const network = parseNetwork(process.env.MIDNIGHT_NETWORK);

  // Align with midnight-js expectations.
  setNetworkId(network === 'standalone' ? 'undeployed' : network === 'mainnet' ? 'mainnet' : network);

  const defaults = (() => {
    if (network === 'standalone') {
      return {
        indexerHttpUrl: 'http://127.0.0.1:8088/api/v3/graphql',
        indexerWsUrl: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
        nodeHttpUrl: 'http://127.0.0.1:9944',
        proofServerHttpUrl: 'http://127.0.0.1:6300',
      };
    }
    if (network === 'preview') {
      return {
        indexerHttpUrl: 'https://indexer.preview.midnight.network/api/v3/graphql',
        indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
        nodeHttpUrl: 'https://rpc.preview.midnight.network',
        proofServerHttpUrl: 'http://127.0.0.1:6300',
      };
    }
    if (network === 'preprod') {
      return {
        indexerHttpUrl: 'https://indexer.preprod.midnight.network/api/v3/graphql',
        indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
        nodeHttpUrl: 'https://rpc.preprod.midnight.network',
        proofServerHttpUrl: 'http://127.0.0.1:6300',
      };
    }
    return {
      indexerHttpUrl: 'https://indexer.midnight.network/api/v3/graphql',
      indexerWsUrl: 'wss://indexer.midnight.network/api/v3/graphql/ws',
      nodeHttpUrl: 'https://rpc.midnight.network',
      proofServerHttpUrl: 'http://127.0.0.1:6300',
    };
  })();

  const zkConfigPathRaw = readCompatEnv('MIDLIGHT_ZK_CONFIG_PATH', 'DARKWALLET_ZK_CONFIG_PATH');
  const statePathRaw = readCompatEnv('MIDLIGHT_STATE_PATH', 'DARKWALLET_STATE_PATH');

  const zkConfigPath = zkConfigPathRaw
    ? path.resolve(zkConfigPathRaw)
    : path.resolve(repoRoot, 'midnight', 'contract', 'src', 'managed', 'pickup');

  const statePath = statePathRaw
    ? path.resolve(statePathRaw)
    : path.resolve(repoRoot, 'services', 'prover', '.data', 'state.json');

  const processRoleRaw = readCompatEnv('MIDLIGHT_PROCESS_ROLE', 'DARKWALLET_PROCESS_ROLE');
  const redisUrlRaw = readCompatEnv('MIDLIGHT_REDIS_URL', 'DARKWALLET_REDIS_URL');
  const databaseUrlRaw = readCompatEnv('MIDLIGHT_DATABASE_URL', 'DARKWALLET_DATABASE_URL');
  const minL1AdaRaw = readCompatEnv('MIDLIGHT_MIN_L1_ADA_LOVELACE', 'DARKWALLET_MIN_L1_ADA_LOVELACE');
  const enforceAttestationRaw = readCompatEnv(
    'MIDLIGHT_ENABLE_ATTESTATION_ENFORCEMENT',
    'DARKWALLET_ENABLE_ATTESTATION_ENFORCEMENT',
  );
  const enableIntentSigningRaw = readCompatEnv('MIDLIGHT_ENABLE_INTENT_SIGNING', 'DARKWALLET_ENABLE_INTENT_SIGNING');
  const allowLegacyRaw = readCompatEnv('MIDLIGHT_ALLOW_LEGACY_JOB_ENDPOINTS', 'DARKWALLET_ALLOW_LEGACY_JOB_ENDPOINTS');
  const oraclePrivateKeyRaw = readCompatEnv('MIDLIGHT_ORACLE_PRIVATE_KEY', 'DARKWALLET_ORACLE_PRIVATE_KEY');
  const oraclePublicKeyRaw = readCompatEnv('MIDLIGHT_ORACLE_PUBLIC_KEY', 'DARKWALLET_ORACLE_PUBLIC_KEY');
  const oracleDomainRaw = readCompatEnv('MIDLIGHT_ORACLE_DOMAIN_TAG', 'DARKWALLET_ORACLE_DOMAIN_TAG');
  const gasSlotCountRaw = readCompatEnv('MIDLIGHT_RELAYER_GAS_SLOT_COUNT', 'DARKWALLET_RELAYER_GAS_SLOT_COUNT');
  const gasSlotValueRaw = readCompatEnv(
    'MIDLIGHT_RELAYER_GAS_SLOT_VALUE_DUST',
    'DARKWALLET_RELAYER_GAS_SLOT_VALUE_DUST',
  );
  const gasLeaseRaw = readCompatEnv('MIDLIGHT_RELAYER_GAS_LEASE_TTL_MS', 'DARKWALLET_RELAYER_GAS_LEASE_TTL_MS');
  const jobConcurrencyRaw = readCompatEnv('MIDLIGHT_JOB_CONCURRENCY', 'DARKWALLET_JOB_CONCURRENCY');
  const apiSecretRaw = readCompatEnv('MIDLIGHT_API_SECRET', 'DARKWALLET_API_SECRET');
  const encryptionKeyRaw = readCompatEnv('MIDLIGHT_ENCRYPTION_KEY', 'DARKWALLET_ENCRYPTION_KEY');
  const tlsCertRaw = readCompatEnv('MIDLIGHT_TLS_CERT', 'DARKWALLET_TLS_CERT');
  const tlsKeyRaw = readCompatEnv('MIDLIGHT_TLS_KEY', 'DARKWALLET_TLS_KEY');

  const config: AppConfig = {
    network,
    processRole: parseProcessRole(processRoleRaw),
    port: parsePort(process.env.PORT),
    indexerHttpUrl: requireUrl(process.env.MIDNIGHT_INDEXER_HTTP ?? defaults.indexerHttpUrl, 'MIDNIGHT_INDEXER_HTTP'),
    indexerWsUrl: requireUrl(process.env.MIDNIGHT_INDEXER_WS ?? defaults.indexerWsUrl, 'MIDNIGHT_INDEXER_WS'),
    nodeHttpUrl: requireUrl(process.env.MIDNIGHT_NODE_HTTP ?? defaults.nodeHttpUrl, 'MIDNIGHT_NODE_HTTP'),
    proofServerHttpUrl: requireUrl(
      process.env.MIDNIGHT_PROOF_SERVER_HTTP ?? defaults.proofServerHttpUrl,
      'MIDNIGHT_PROOF_SERVER_HTTP',
    ),
    redisUrl: redisUrlRaw ?? 'redis://127.0.0.1:6379',
    databaseUrl: databaseUrlRaw,
    blockfrostProjectId: process.env.BLOCKFROST_PROJECT_ID,
    blockfrostBaseUrl: process.env.BLOCKFROST_BASE_URL,
    attestationTtlMs: parsePositiveInt(process.env.ATTESTATION_TTL_MS, 5 * 60 * 1000),
    attestationMaxClockSkewMs: parsePositiveInt(process.env.ATTESTATION_MAX_CLOCK_SKEW_MS, 30_000),
    attestationProofValidityMs: parsePositiveInt(process.env.ATTESTATION_PROOF_VALIDITY_MS, 24 * 60 * 60 * 1000),
    minL1AdaLovelace: parsePositiveBigInt(minL1AdaRaw, 5_000_000n),
    enableAttestationEnforcement: parseBool(enforceAttestationRaw, network === 'mainnet'),
    enableIntentSigning: parseBool(enableIntentSigningRaw, network !== 'standalone'),
    allowLegacyJobEndpoints: parseBool(allowLegacyRaw, network === 'standalone'),
    oraclePrivateKeyHex: oraclePrivateKeyRaw,
    oraclePublicKeyHex: oraclePublicKeyRaw,
    oracleDomainTag: oracleDomainRaw ?? 'darkwallet:oracle:v1',
    relayerGasSlotCount: parsePositiveInt(gasSlotCountRaw, 64),
    relayerGasSlotValueDust: parsePositiveBigInt(gasSlotValueRaw, 5n),
    relayerGasLeaseTtlMs: parsePositiveInt(gasLeaseRaw, 2 * 60 * 1000),
    jobConcurrency: parsePositiveInt(jobConcurrencyRaw, 2),
    apiSecret: apiSecretRaw?.trim() || undefined,
    encryptionKeyHex: normalizeHexKey(encryptionKeyRaw, 'MIDLIGHT_ENCRYPTION_KEY / DARKWALLET_ENCRYPTION_KEY'),
    tlsCertPath: tlsCertRaw ? path.resolve(tlsCertRaw) : undefined,
    tlsKeyPath: tlsKeyRaw ? path.resolve(tlsKeyRaw) : undefined,
    walletSeedHex: process.env.MIDNIGHT_WALLET_SEED,
    zkConfigPath: requireValue(zkConfigPath, 'MIDLIGHT_ZK_CONFIG_PATH (derived default)'),
    statePath: requireValue(statePath, 'MIDLIGHT_STATE_PATH (derived default)'),
  };

  if (network === 'mainnet') {
    const required = [
      ['MIDLIGHT_DATABASE_URL', 'DARKWALLET_DATABASE_URL', config.databaseUrl],
      ['BLOCKFROST_PROJECT_ID', 'BLOCKFROST_PROJECT_ID', config.blockfrostProjectId],
      ['MIDNIGHT_WALLET_SEED', 'MIDNIGHT_WALLET_SEED', config.walletSeedHex],
    ] as const;
    for (const [legacyName, modernName, value] of required) {
      if (!value || String(value).trim() === '') {
        throw new Error(`${legacyName} (or ${modernName}) is required for mainnet`);
      }
    }
  }

  return config;
};
