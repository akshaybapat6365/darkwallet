import { describe, expect, it } from 'vitest';

import { verifyCip30Signature } from '../attestation/cip30-verify.js';
import { createWalletFixture } from './helpers/cip30-fixture.js';

describe('CIP-30 signature verification', () => {
  it('accepts valid signature and rejects tampered payload', async () => {
    const payloadHex = Buffer.from('{"hello":"midlight"}', 'utf8').toString('hex');
    const fixture = await createWalletFixture(payloadHex);

    const valid = await verifyCip30Signature({
      walletAddress: fixture.walletAddressHex,
      signedPayloadHex: fixture.signedPayloadHex,
      coseSign1Hex: fixture.coseSign1Hex,
      coseKeyHex: fixture.coseKeyHex,
    });
    expect(valid.keyHashHex).toMatch(/^[0-9a-f]{56}$/);

    await expect(
      verifyCip30Signature({
        walletAddress: fixture.walletAddressHex,
        signedPayloadHex: fixture.signedPayloadHex.replace(/.$/, '0'),
        coseSign1Hex: fixture.coseSign1Hex,
        coseKeyHex: fixture.coseKeyHex,
      }),
    ).rejects.toThrow(/does not match submitted payload|verification failed/i);
  });

  it('rejects oversized COSE payloads before decode', async () => {
    const payloadHex = Buffer.from('{"hello":"midlight"}', 'utf8').toString('hex');
    const fixture = await createWalletFixture(payloadHex);
    const oversized = `${fixture.coseSign1Hex}${'00'.repeat(5000)}`;

    await expect(
      verifyCip30Signature({
        walletAddress: fixture.walletAddressHex,
        signedPayloadHex: fixture.signedPayloadHex,
        coseSign1Hex: oversized,
        coseKeyHex: fixture.coseKeyHex,
      }),
    ).rejects.toThrow(/exceeds maximum allowed size/i);
  });
});
