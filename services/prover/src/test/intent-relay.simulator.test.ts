import { describe, expect, it } from 'vitest';

import { AttestationService } from '../attestation/service.js';
import { IntentService } from '../intents/service.js';
import type { AppConfig } from '../config.js';
import type { PreparedIntent, IntentStore } from '../state/intent-store.js';
import { InMemoryAttestationStore } from '../state/attestation-store.js';
import type { StateStore } from '../state/store.js';
import { createWalletFixture } from './helpers/cip30-fixture.js';

const mockConfig = (overrides?: Partial<AppConfig>): AppConfig => ({
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
  attestationTtlMs: 5_000,
  attestationMaxClockSkewMs: 1_000,
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
  ...overrides,
});

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

class MemoryIntentStore implements IntentStore {
  readonly intents = new Map<string, PreparedIntent>();
  readonly nonces = new Set<string>();

  async createPreparedIntent(intent: PreparedIntent): Promise<void> {
    this.intents.set(intent.intentId, { ...intent });
  }
  async getPreparedIntent(intentId: string): Promise<PreparedIntent | null> {
    const out = this.intents.get(intentId);
    return out ? { ...out } : null;
  }
  async setIntentStatus(intentId: string, status: PreparedIntent['status']): Promise<void> {
    const out = this.intents.get(intentId);
    if (!out) return;
    this.intents.set(intentId, { ...out, status });
  }
  async setIntentGasSlot(intentId: string, gasSlotId: string | null): Promise<void> {
    const out = this.intents.get(intentId);
    if (!out) return;
    this.intents.set(intentId, { ...out, gasSlotId });
  }
  async claimNonce(params: { walletAddress: string; nonce: string; action: 'registerAuthorization' | 'redeem'; chainId: string }): Promise<void> {
    const key = `${params.walletAddress}|${params.nonce}|${params.action}|${params.chainId}`;
    if (this.nonces.has(key)) throw new Error('Intent nonce replay detected');
    this.nonces.add(key);
  }
}

describe('adversarial simulator matrix (service-level)', () => {
  it('detects stale and wrong-asset attestations', async () => {
    const store = new InMemoryAttestationStore();
    const now = Date.now();
    await store.createProof({
      attestationHash: 'expired-hash',
      challengeId: 'challenge-a',
      walletAddress: 'addr_test1x',
      assetFingerprint: 'asset1good',
      verificationSource: 'blockfrost',
      midnightAddress: '11'.repeat(32),
      oracleEnvelope: {
        algorithm: 'ed25519',
        domainTag: 'midlight:oracle:v1',
        payload: {
          cardanoAddress: 'addr_test1x',
          assetFingerprint: 'asset1good',
          midnightAddress: '11'.repeat(32),
          challengeId: 'challenge-a',
          nonce: 'n-1',
          verifiedAt: new Date(now - 10_000).toISOString(),
        },
        payloadHashHex: 'aa'.repeat(32),
        publicKeyHex: 'bb'.repeat(32),
        signatureHex: 'cc'.repeat(64),
      },
      verifiedAt: new Date(now - 10_000).toISOString(),
      expiresAt: new Date(now - 5_000).toISOString(),
      revokedAt: null,
    });
    await store.createProof({
      attestationHash: 'asset-hash',
      challengeId: 'challenge-b',
      walletAddress: 'addr_test1x',
      assetFingerprint: 'asset1good',
      verificationSource: 'blockfrost',
      midnightAddress: '11'.repeat(32),
      oracleEnvelope: {
        algorithm: 'ed25519',
        domainTag: 'midlight:oracle:v1',
        payload: {
          cardanoAddress: 'addr_test1x',
          assetFingerprint: 'asset1good',
          midnightAddress: '11'.repeat(32),
          challengeId: 'challenge-b',
          nonce: 'n-2',
          verifiedAt: new Date(now).toISOString(),
        },
        payloadHashHex: 'dd'.repeat(32),
        publicKeyHex: 'ee'.repeat(32),
        signatureHex: 'ff'.repeat(64),
      },
      verifiedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 50_000).toISOString(),
      revokedAt: null,
    });

    const service = new AttestationService({
      store,
      blockfrost: {
        async assertAssetOwnership() {
          return { quantity: '1' };
        },
        async assertMinimumAdaBalance() {
          return { lovelace: 10_000_000n };
        },
      } as any,
      oracleSigner: {
        publicKeyHex: '00'.repeat(32),
        domainTag: 'midlight:oracle:v1',
        async sign(payload) {
          return {
            algorithm: 'ed25519' as const,
            domainTag: 'midlight:oracle:v1',
            payload,
            payloadHashHex: '11'.repeat(32),
            publicKeyHex: '22'.repeat(32),
            signatureHex: '33'.repeat(64),
          };
        },
      },
      config: { network: 'preview', ttlMs: 1_000, maxClockSkewMs: 100 },
    });

    await expect(service.requireValidAttestation({ attestationHash: 'expired-hash' })).rejects.toThrow(/expired/i);
    await expect(
      service.requireValidAttestation({ attestationHash: 'asset-hash', assetFingerprint: 'asset1different' }),
    ).rejects.toThrow(/asset mismatch/i);
  });

  it('detects nonce replay and concurrent double submit races', async () => {
    const intentStore = new MemoryIntentStore();
    const intentService = new IntentService({
      config: mockConfig(),
      stateStore,
      intentStore,
      attestation: { async requireValidAttestation() {} } as any,
      relayerGasStore: {
        async bootstrap() {},
        async lease(params) {
          return {
            slotId: `slot-${params.intentId}`,
            slotValueDust: 5n,
            leasedByIntentId: params.intentId,
            leasedAt: new Date().toISOString(),
            leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
          };
        },
        async release() {},
      },
    });

    const first = await intentService.prepareIntent({
      action: 'redeem',
      body: {
        patientId: '11111111-1111-1111-1111-111111111111',
        rxId: '1',
        pharmacyIdHex: '22'.repeat(32),
      },
    });
    const second = await intentService.prepareIntent({
      action: 'redeem',
      body: {
        patientId: '11111111-1111-1111-1111-111111111111',
        rxId: '2',
        pharmacyIdHex: '22'.repeat(32),
      },
    });

    const secondPrepared = intentStore.intents.get(second.intentId)!;
    secondPrepared.nonce = intentStore.intents.get(first.intentId)!.nonce;
    intentStore.intents.set(second.intentId, secondPrepared);

    const firstSig = await createWalletFixture(first.payloadHex);
    await intentService.submitIntent({
      intentId: first.intentId,
      walletAddress: firstSig.walletAddressHex,
      signedPayloadHex: firstSig.signedPayloadHex,
      coseSign1Hex: firstSig.coseSign1Hex,
      coseKeyHex: firstSig.coseKeyHex,
    });

    const secondSig = await createWalletFixture(second.payloadHex, { privateKeyHex: firstSig.privateKeyHex });
    await expect(
      intentService.submitIntent({
        intentId: second.intentId,
        walletAddress: firstSig.walletAddressHex,
        signedPayloadHex: secondSig.signedPayloadHex,
        coseSign1Hex: secondSig.coseSign1Hex,
        coseKeyHex: secondSig.coseKeyHex,
      }),
    ).rejects.toThrow(/replay/i);

    const race = await intentService.prepareIntent({
      action: 'redeem',
      body: {
        patientId: '11111111-1111-1111-1111-111111111111',
        rxId: '3',
        pharmacyIdHex: '22'.repeat(32),
      },
    });
    const raceSig = await createWalletFixture(race.payloadHex);

    const [a, b] = await Promise.allSettled([
      intentService.submitIntent({
        intentId: race.intentId,
        walletAddress: raceSig.walletAddressHex,
        signedPayloadHex: raceSig.signedPayloadHex,
        coseSign1Hex: raceSig.coseSign1Hex,
        coseKeyHex: raceSig.coseKeyHex,
      }),
      intentService.submitIntent({
        intentId: race.intentId,
        walletAddress: raceSig.walletAddressHex,
        signedPayloadHex: raceSig.signedPayloadHex,
        coseSign1Hex: raceSig.coseSign1Hex,
        coseKeyHex: raceSig.coseKeyHex,
      }),
    ]);

    const fulfilled = [a, b].filter((x) => x.status === 'fulfilled').length;
    const rejected = [a, b].filter((x) => x.status === 'rejected').length;
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
  });

  it('simulates worker restart mid-relay with idempotent completion', async () => {
    type SimJob = { jobId: string; intentId: string; stage: 'QUEUED' | 'RELAYING' | 'CONFIRMED' };
    const persistedJobs = new Map<string, SimJob>();
    persistedJobs.set('intent:123:redeem', { jobId: 'intent:123:redeem', intentId: '123', stage: 'QUEUED' });

    const runWorkerCycle = (opts: { crashMidRelay: boolean }) => {
      for (const [jobId, job] of persistedJobs) {
        if (job.stage === 'CONFIRMED') continue;
        if (job.stage === 'QUEUED') {
          persistedJobs.set(jobId, { ...job, stage: 'RELAYING' });
          if (opts.crashMidRelay) {
            return;
          }
        }
        if (persistedJobs.get(jobId)?.stage === 'RELAYING') {
          persistedJobs.set(jobId, { ...job, stage: 'CONFIRMED' });
        }
      }
    };

    runWorkerCycle({ crashMidRelay: true });
    expect(persistedJobs.get('intent:123:redeem')?.stage).toBe('RELAYING');

    runWorkerCycle({ crashMidRelay: false });
    expect(persistedJobs.get('intent:123:redeem')?.stage).toBe('CONFIRMED');
  });
});
