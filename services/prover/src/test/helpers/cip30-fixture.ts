import * as cbor from 'cbor';
import * as ed25519 from '@noble/ed25519';
import { blake2b } from '@noble/hashes/blake2b';

const bytesToHex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const hexToBytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replace(/^0x/i, ''), 'hex'));

export type Cip30Fixture = {
  privateKeyHex: string;
  walletAddressHex: string;
  coseSign1Hex: string;
  coseKeyHex: string;
  signedPayloadHex: string;
};

export const createWalletFixture = async (
  payloadHex: string,
  options?: { privateKeyHex?: string },
): Promise<Cip30Fixture> => {
  const privateKey = options?.privateKeyHex ? hexToBytes(options.privateKeyHex) : Uint8Array.from(ed25519.utils.randomPrivateKey());
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  const keyHash = blake2b(publicKey, { dkLen: 28 });
  const walletAddressBytes = new Uint8Array(29);
  walletAddressBytes[0] = 0x60; // Enterprise/test-network key hash
  walletAddressBytes.set(keyHash, 1);

  const protectedHeaders = cbor.encode(new Map([[1, -8]]));
  const payloadBytes = hexToBytes(payloadHex);
  const sigStructure = Uint8Array.from(cbor.encode(['Signature1', protectedHeaders, Buffer.alloc(0), Buffer.from(payloadBytes)]));
  const signature = await ed25519.signAsync(sigStructure, privateKey);

  const coseSign1 = cbor.encode([protectedHeaders, new Map(), Buffer.from(payloadBytes), Buffer.from(signature)]);
  const coseKey = cbor.encode(
    new Map([
      [1, 1], // kty: OKP
      [3, -8], // alg: EdDSA
      [-1, 6], // crv: Ed25519
      [-2, Buffer.from(publicKey)],
    ]),
  );

  return {
    privateKeyHex: bytesToHex(privateKey),
    walletAddressHex: bytesToHex(walletAddressBytes),
    coseSign1Hex: bytesToHex(coseSign1),
    coseKeyHex: bytesToHex(coseKey),
    signedPayloadHex: payloadHex.replace(/^0x/i, ''),
  };
};
