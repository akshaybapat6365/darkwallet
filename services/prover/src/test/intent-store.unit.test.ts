import { describe, expect, it } from 'vitest';

import { createIntentStore } from '../state/intent-store.js';
import type { AppConfig } from '../config.js';

const baseConfig: AppConfig = {
  network: 'standalone',
  processRole: 'all',
  port: 4000,
  indexerHttpUrl: '',
  indexerWsUrl: '',
  nodeHttpUrl: '',
  proofServerHttpUrl: '',
  redisUrl: 'redis://127.0.0.1:6379',
  databaseUrl: undefined,
  blockfrostProjectId: undefined,
  blockfrostBaseUrl: undefined,
  attestationTtlMs: 1000,
  attestationMaxClockSkewMs: 1000,
  attestationProofValidityMs: 60_000,
  minL1AdaLovelace: 0n,
  enableAttestationEnforcement: false,
  enableIntentSigning: true,
  allowLegacyJobEndpoints: false,
  oraclePrivateKeyHex: undefined,
  oraclePublicKeyHex: undefined,
  oracleDomainTag: 'midlight:oracle:v1',
  relayerGasSlotCount: 16,
  relayerGasSlotValueDust: 5n,
  relayerGasLeaseTtlMs: 120_000,
  jobConcurrency: 2,
  walletSeedHex: undefined,
  zkConfigPath: '',
  statePath: '',
};

describe('intent nonce replay protection', () => {
  it('rejects duplicate nonce claims for same wallet/action/chain', async () => {
    const store = await createIntentStore(baseConfig);

    await store.claimNonce({
      walletAddress: 'addr_test1xyz',
      nonce: 'nonce-1',
      action: 'redeem',
      chainId: 'preview',
      intentId: 'intent-a',
    });

    await expect(
      store.claimNonce({
        walletAddress: 'addr_test1xyz',
        nonce: 'nonce-1',
        action: 'redeem',
        chainId: 'preview',
        intentId: 'intent-b',
      }),
    ).rejects.toThrow(/replay/i);
  });
});
