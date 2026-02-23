import * as ed25519 from '@noble/ed25519';
import { describe, expect, it } from 'vitest';

import { createOracleSigner, hashOraclePayload } from '../attestation/oracle-signer.js';

const hexToBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));

describe('oracle signer', () => {
  it('produces deterministic payload hashes and verifiable signatures', async () => {
    const signer = await createOracleSigner({
      domainTag: 'midlight:oracle:v1',
      privateKeyHex: '01'.repeat(32),
    });

    const payload = {
      cardanoAddress: 'addr_test1qpz4...',
      assetFingerprint: 'asset1midlight',
      midnightAddress: 'ab'.repeat(32),
      challengeId: '00000000-0000-4000-9000-000000000001',
      nonce: 'nonce-1',
      verifiedAt: '2026-02-20T00:00:00.000Z',
    } as const;

    const envelope = await signer.sign(payload);
    const firstHash = hashOraclePayload('midlight:oracle:v1', payload);
    const secondHash = hashOraclePayload('midlight:oracle:v1', payload);
    expect(firstHash).toBe(secondHash);
    expect(envelope.payloadHashHex).toBe(firstHash);

    const verified = await ed25519.verifyAsync(
      hexToBytes(envelope.signatureHex),
      hexToBytes(envelope.payloadHashHex),
      hexToBytes(envelope.publicKeyHex),
    );
    expect(verified).toBe(true);

    const tamperedHash = hashOraclePayload('midlight:oracle:v1', {
      ...payload,
      assetFingerprint: 'asset1different',
    });
    const tamperedVerified = await ed25519.verifyAsync(
      hexToBytes(envelope.signatureHex),
      hexToBytes(tamperedHash),
      hexToBytes(envelope.publicKeyHex),
    );
    expect(tamperedVerified).toBe(false);
  });

  it('rejects invalid oracle key configurations', async () => {
    await expect(
      createOracleSigner({
        domainTag: 'darkwallet:oracle:v1',
        privateKeyHex: '01'.repeat(32),
        publicKeyHex: 'ff'.repeat(32),
      }),
    ).rejects.toThrow(/does not match/i);

    await expect(
      createOracleSigner({
        domainTag: 'darkwallet:oracle:v1',
        publicKeyHex: '01'.repeat(32),
      }),
    ).rejects.toThrow(/requires both private and public key material/i);
  });
});
