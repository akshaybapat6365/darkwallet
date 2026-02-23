import { describe, expect, it } from 'vitest';

import { buildIntentTypedPayload, encodeTypedPayload } from '../intents/typed-intent.js';

describe('typed intent payload', () => {
  it('hashing and payload encoding are deterministic', () => {
    const payload = buildIntentTypedPayload({
      chainId: 'preview',
      intentId: 'f8bdf6aa-bf6f-4e22-8963-f19744bc10cc',
      action: 'registerAuthorization',
      contractAddress: '0xabc123',
      rxId: '1',
      pharmacyIdHex: '0f'.repeat(32),
      patientPublicKeyHex: '1a'.repeat(32),
      attestationHash: '2b'.repeat(32),
      nonce: 'n-1',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:10:00.000Z',
    });

    const first = encodeTypedPayload(payload as unknown as Record<string, unknown>);
    const second = encodeTypedPayload(payload as unknown as Record<string, unknown>);

    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.payloadHex).toBe(second.payloadHex);
    expect(first.payloadHashHex).toBe(second.payloadHashHex);
    expect(first.payloadHashHex).toMatch(/^[0-9a-f]{64}$/);
  });
});
