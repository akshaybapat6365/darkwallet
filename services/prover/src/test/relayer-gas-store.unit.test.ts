import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../config.js';
import { createRelayerGasStore } from '../state/relayer-gas-store.js';

const config: AppConfig = {
  network: 'preview',
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
  enableAttestationEnforcement: true,
  enableIntentSigning: true,
  allowLegacyJobEndpoints: false,
  oraclePrivateKeyHex: undefined,
  oraclePublicKeyHex: undefined,
  oracleDomainTag: 'midlight:oracle:v1',
  relayerGasSlotCount: 2,
  relayerGasSlotValueDust: 5n,
  relayerGasLeaseTtlMs: 2_000,
  jobConcurrency: 2,
  walletSeedHex: undefined,
  zkConfigPath: '',
  statePath: '',
};

describe('relayer gas store', () => {
  it('leases distinct slots and supports release/reacquire', async () => {
    const store = await createRelayerGasStore(config);
    await store.bootstrap({ slotCount: 2, slotValueDust: 5n });

    const [a, b] = await Promise.all([
      store.lease({ intentId: 'intent-a', leaseTtlMs: 5_000 }),
      store.lease({ intentId: 'intent-b', leaseTtlMs: 5_000 }),
    ]);

    expect(a.slotId).not.toBe(b.slotId);
    await expect(store.lease({ intentId: 'intent-c', leaseTtlMs: 5_000 })).rejects.toThrow(/No relayer gas slots/i);

    await store.release({ slotId: a.slotId });
    const c = await store.lease({ intentId: 'intent-c', leaseTtlMs: 5_000 });
    expect(c.slotId).toBe(a.slotId);
  });
});
