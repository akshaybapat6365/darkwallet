import { describe, expect, it } from 'vitest';

import { IntentService } from '../intents/service.js';
import { createIntentStore } from '../state/intent-store.js';
import type { AppConfig } from '../config.js';
import type { StateStore } from '../state/store.js';
import { createWalletFixture } from './helpers/cip30-fixture.js';

const baseConfig: AppConfig = {
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
  relayerGasSlotCount: 16,
  relayerGasSlotValueDust: 5n,
  relayerGasLeaseTtlMs: 120_000,
  jobConcurrency: 2,
  walletSeedHex: undefined,
  zkConfigPath: '',
  statePath: '',
};

const stateStore: StateStore = {
  async read() {
    return {
      contractAddress: '0xabc',
      patients: {
        '11111111-1111-1111-1111-111111111111': {
          patientSecretKeyHex: '00'.repeat(32),
          patientPublicKeyHex: '11'.repeat(32),
        },
      },
    };
  },
  async write() {},
  async update(fn) {
    return fn(await this.read());
  },
};

describe('intent submission attestation policy', () => {
  it('requires valid attestation when enforcement flag is enabled', async () => {
    const intentStore = await createIntentStore(baseConfig);
    const attestationService = {
      async requireValidAttestation(params: { attestationHash: string }) {
        if (params.attestationHash !== 'good-attestation') {
          throw new Error('Attestation not found');
        }
        return {
          attestationHash: params.attestationHash,
          walletAddress: 'addr_test1',
          assetFingerprint: 'asset1ok',
        };
      },
    };

    const service = new IntentService({
      config: baseConfig,
      stateStore,
      intentStore,
      attestation: attestationService as any,
      relayerGasStore: {
        async bootstrap() {},
        async lease() {
          return {
            slotId: 'slot-001',
            slotValueDust: 5n,
            leasedByIntentId: 'intent-test',
            leasedAt: new Date().toISOString(),
            leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          };
        },
        async release() {},
      },
    });

    await expect(
      service.prepareIntent({
        action: 'redeem',
        body: {
          patientId: '11111111-1111-1111-1111-111111111111',
          rxId: '1',
          pharmacyIdHex: '22'.repeat(32),
        },
      }),
    ).rejects.toThrow(/Attestation is required/i);

    const prepared = await service.prepareIntent({
      action: 'redeem',
      body: {
        patientId: '11111111-1111-1111-1111-111111111111',
        rxId: '1',
        pharmacyIdHex: '22'.repeat(32),
        attestationHash: 'good-attestation',
      },
    });
    const fixture = await createWalletFixture(prepared.payloadHex);

    const submitted = await service.submitIntent({
      intentId: prepared.intentId,
      walletAddress: fixture.walletAddressHex,
      signedPayloadHex: fixture.signedPayloadHex,
      coseSign1Hex: fixture.coseSign1Hex,
      coseKeyHex: fixture.coseKeyHex,
    });
    expect(submitted.intent.intentId).toBe(prepared.intentId);
  });
});
