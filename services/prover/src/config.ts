import path from 'node:path';

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

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
  throw new Error(`Invalid MIDLIGHT_PROCESS_ROLE: ${raw}`);
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

  const zkConfigPath = process.env.MIDLIGHT_ZK_CONFIG_PATH
    ? path.resolve(process.env.MIDLIGHT_ZK_CONFIG_PATH)
    : path.resolve(repoRoot, 'midnight', 'contract', 'src', 'managed', 'pickup');

  const statePath = process.env.MIDLIGHT_STATE_PATH
    ? path.resolve(process.env.MIDLIGHT_STATE_PATH)
    : path.resolve(repoRoot, 'services', 'prover', '.data', 'state.json');

  return {
    network,
    processRole: parseProcessRole(process.env.MIDLIGHT_PROCESS_ROLE),
    port: parsePort(process.env.PORT),
    indexerHttpUrl: requireUrl(process.env.MIDNIGHT_INDEXER_HTTP ?? defaults.indexerHttpUrl, 'MIDNIGHT_INDEXER_HTTP'),
    indexerWsUrl: requireUrl(process.env.MIDNIGHT_INDEXER_WS ?? defaults.indexerWsUrl, 'MIDNIGHT_INDEXER_WS'),
    nodeHttpUrl: requireUrl(process.env.MIDNIGHT_NODE_HTTP ?? defaults.nodeHttpUrl, 'MIDNIGHT_NODE_HTTP'),
    proofServerHttpUrl: requireUrl(
      process.env.MIDNIGHT_PROOF_SERVER_HTTP ?? defaults.proofServerHttpUrl,
      'MIDNIGHT_PROOF_SERVER_HTTP',
    ),
    redisUrl: process.env.MIDLIGHT_REDIS_URL ?? 'redis://127.0.0.1:6379',
    databaseUrl: process.env.MIDLIGHT_DATABASE_URL,
    blockfrostProjectId: process.env.BLOCKFROST_PROJECT_ID,
    blockfrostBaseUrl: process.env.BLOCKFROST_BASE_URL,
    attestationTtlMs: parsePositiveInt(process.env.ATTESTATION_TTL_MS, 5 * 60 * 1000),
    attestationMaxClockSkewMs: parsePositiveInt(process.env.ATTESTATION_MAX_CLOCK_SKEW_MS, 30_000),
    attestationProofValidityMs: parsePositiveInt(process.env.ATTESTATION_PROOF_VALIDITY_MS, 24 * 60 * 60 * 1000),
    minL1AdaLovelace: parsePositiveBigInt(process.env.MIDLIGHT_MIN_L1_ADA_LOVELACE, 5_000_000n),
    enableAttestationEnforcement: parseBool(process.env.MIDLIGHT_ENABLE_ATTESTATION_ENFORCEMENT, false),
    enableIntentSigning: parseBool(process.env.MIDLIGHT_ENABLE_INTENT_SIGNING, network !== 'standalone'),
    allowLegacyJobEndpoints: parseBool(process.env.MIDLIGHT_ALLOW_LEGACY_JOB_ENDPOINTS, network === 'standalone'),
    oraclePrivateKeyHex: process.env.MIDLIGHT_ORACLE_PRIVATE_KEY,
    oraclePublicKeyHex: process.env.MIDLIGHT_ORACLE_PUBLIC_KEY,
    oracleDomainTag: process.env.MIDLIGHT_ORACLE_DOMAIN_TAG ?? 'midlight:oracle:v1',
    relayerGasSlotCount: parsePositiveInt(process.env.MIDLIGHT_RELAYER_GAS_SLOT_COUNT, 64),
    relayerGasSlotValueDust: parsePositiveBigInt(process.env.MIDLIGHT_RELAYER_GAS_SLOT_VALUE_DUST, 5n),
    relayerGasLeaseTtlMs: parsePositiveInt(process.env.MIDLIGHT_RELAYER_GAS_LEASE_TTL_MS, 2 * 60 * 1000),
    jobConcurrency: parsePositiveInt(process.env.MIDLIGHT_JOB_CONCURRENCY, 2),
    apiSecret: process.env.MIDLIGHT_API_SECRET?.trim() || undefined,
    encryptionKeyHex: normalizeHexKey(process.env.MIDLIGHT_ENCRYPTION_KEY, 'MIDLIGHT_ENCRYPTION_KEY'),
    tlsCertPath: process.env.MIDLIGHT_TLS_CERT ? path.resolve(process.env.MIDLIGHT_TLS_CERT) : undefined,
    tlsKeyPath: process.env.MIDLIGHT_TLS_KEY ? path.resolve(process.env.MIDLIGHT_TLS_KEY) : undefined,
    walletSeedHex: process.env.MIDNIGHT_WALLET_SEED,
    zkConfigPath: requireValue(zkConfigPath, 'MIDLIGHT_ZK_CONFIG_PATH (derived default)'),
    statePath: requireValue(statePath, 'MIDLIGHT_STATE_PATH (derived default)'),
  };
};
