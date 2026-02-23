import { describe, expect, it } from 'vitest';

import { AttestationService } from '../attestation/service.js';
import { InMemoryAttestationStore } from '../state/attestation-store.js';
import { createWalletFixture } from './helpers/cip30-fixture.js';

describe('attestation verification integration', () => {
  it('verifies challenge only when wallet owns the requested asset fingerprint', async () => {
    const store = new InMemoryAttestationStore();
    const payloadAsset = 'asset1midlightowned';

    const allowClient = {
      async assertAssetOwnership(params: { assetFingerprint: string; walletAddress: string }) {
        if (params.assetFingerprint !== payloadAsset) throw new Error('unknown asset');
        if (!params.walletAddress) throw new Error('no wallet');
        return { quantity: '1' };
      },
      async assertMinimumAdaBalance() {
        return { lovelace: 10_000_000n };
      },
    };

    const service = new AttestationService({
      store,
      blockfrost: allowClient as any,
      oracleSigner: {
        publicKeyHex: '11'.repeat(32),
        domainTag: 'midlight:oracle:v1',
        async sign(payload) {
          return {
            algorithm: 'ed25519' as const,
            domainTag: 'midlight:oracle:v1',
            payload,
            payloadHashHex: '22'.repeat(32),
            publicKeyHex: '11'.repeat(32),
            signatureHex: '33'.repeat(64),
          };
        },
      },
      config: {
        network: 'preview',
        ttlMs: 60_000,
        maxClockSkewMs: 1_000,
      },
    });

    const challenge = await service.createChallenge({
      assetFingerprint: payloadAsset,
      walletAddress: null,
      midnightAddress: 'ab'.repeat(32),
    });
    const signature = await createWalletFixture(challenge.payloadHex);

    const verified = await service.verifyChallenge({
      challengeId: challenge.challengeId,
      walletAddress: signature.walletAddressHex,
      midnightAddress: 'ab'.repeat(32),
      assetFingerprint: payloadAsset,
      signedPayloadHex: signature.signedPayloadHex,
      coseSign1Hex: signature.coseSign1Hex,
      coseKeyHex: signature.coseKeyHex,
    });
    expect(verified.verified).toBe(true);
    expect(verified.oracleEnvelope.signatureHex).toMatch(/^[0-9a-f]+$/);

    const denyClient = {
      async assertAssetOwnership() {
        throw new Error('Wallet does not currently own the requested asset fingerprint');
      },
      async assertMinimumAdaBalance() {
        return { lovelace: 10_000_000n };
      },
    };
    const denyService = new AttestationService({
      store: new InMemoryAttestationStore(),
      blockfrost: denyClient as any,
      oracleSigner: {
        publicKeyHex: '11'.repeat(32),
        domainTag: 'midlight:oracle:v1',
        async sign(payload) {
          return {
            algorithm: 'ed25519' as const,
            domainTag: 'midlight:oracle:v1',
            payload,
            payloadHashHex: '22'.repeat(32),
            publicKeyHex: '11'.repeat(32),
            signatureHex: '33'.repeat(64),
          };
        },
      },
      config: {
        network: 'preview',
        ttlMs: 60_000,
        maxClockSkewMs: 1_000,
      },
    });
    const denyChallenge = await denyService.createChallenge({
      assetFingerprint: 'asset1other',
      walletAddress: null,
      midnightAddress: 'cd'.repeat(32),
    });
    const denySignature = await createWalletFixture(denyChallenge.payloadHex);

    await expect(
      denyService.verifyChallenge({
        challengeId: denyChallenge.challengeId,
        walletAddress: denySignature.walletAddressHex,
        midnightAddress: 'cd'.repeat(32),
        assetFingerprint: 'asset1other',
        signedPayloadHex: denySignature.signedPayloadHex,
        coseSign1Hex: denySignature.coseSign1Hex,
        coseKeyHex: denySignature.coseKeyHex,
      }),
    ).rejects.toThrow(/does not currently own/i);
  });

  it('returns service-unavailable when Blockfrost is not configured', async () => {
    const service = new AttestationService({
      store: new InMemoryAttestationStore(),
      blockfrost: null,
      oracleSigner: {
        publicKeyHex: '11'.repeat(32),
        domainTag: 'darkwallet:oracle:v1',
        async sign(payload) {
          return {
            algorithm: 'ed25519' as const,
            domainTag: 'darkwallet:oracle:v1',
            payload,
            payloadHashHex: '22'.repeat(32),
            publicKeyHex: '11'.repeat(32),
            signatureHex: '33'.repeat(64),
          };
        },
      },
      config: {
        network: 'preview',
        ttlMs: 60_000,
        maxClockSkewMs: 1_000,
      },
    });

    const challenge = await service.createChallenge({
      assetFingerprint: 'asset1x',
      walletAddress: null,
      midnightAddress: null,
    });
    const signature = await createWalletFixture(challenge.payloadHex);

    await expect(
      service.verifyChallenge({
        challengeId: challenge.challengeId,
        walletAddress: signature.walletAddressHex,
        midnightAddress: null,
        assetFingerprint: 'asset1x',
        signedPayloadHex: signature.signedPayloadHex,
        coseSign1Hex: signature.coseSign1Hex,
        coseKeyHex: signature.coseKeyHex,
      }),
    ).rejects.toThrow(/BLOCKFROST_PROJECT_ID is not configured/i);
  });
});
