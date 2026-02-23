import { blake2b } from '@noble/hashes/blake2b';
import * as ed25519 from '@noble/ed25519';
import * as cbor from 'cbor';
import { bech32 } from '@scure/base';
import { bytesToHex, hexToBytes, strip0x } from '../utils/hex.js';

type VerifyParams = {
  walletAddress: string;
  signedPayloadHex: string;
  coseSign1Hex: string;
  coseKeyHex: string;
};

export type VerifyResult = {
  publicKeyHex: string;
  keyHashHex: string;
  walletAddressBech32: string;
};

type CoseKeyMap = Map<number, Uint8Array | number>;
const MAX_COSE_BYTES = 4096;

const toBytes = (input: unknown, label: string): Uint8Array => {
  if (input instanceof Uint8Array) return Uint8Array.from(input);
  if (Buffer.isBuffer(input)) return Uint8Array.from(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error(`Invalid ${label}`);
};

const decodeAddress = (walletAddress: string): Uint8Array => {
  const lower = walletAddress.toLowerCase();
  if (lower.startsWith('addr') || lower.startsWith('stake')) {
    const decoded = bech32.decode(walletAddress as `${string}1${string}`, 1500);
    return Uint8Array.from(bech32.fromWords(decoded.words));
  }
  return hexToBytes(walletAddress);
};

const encodeAddressBech32 = (walletAddress: string): string => {
  const lower = walletAddress.toLowerCase();
  if (lower.startsWith('addr') || lower.startsWith('stake')) return walletAddress;
  const bytes = decodeAddress(walletAddress);
  const networkId = bytes[0] & 0x0f;
  const prefix = networkId === 1 ? 'addr' : 'addr_test';
  return bech32.encode(prefix, bech32.toWords(bytes), 1500);
};

const extractCoseKeyPublicKey = (coseKeyRaw: unknown): Uint8Array => {
  if (!(coseKeyRaw instanceof Map)) throw new Error('COSE key must be a CBOR map');
  const map = coseKeyRaw as CoseKeyMap;
  const x = toBytes(map.get(-2), 'COSE key public key');
  if (x.length !== 32) throw new Error('COSE key does not contain valid Ed25519 public key');
  return x;
};

const extractCredentialHashes = (addressBytes: Uint8Array): string[] => {
  if (addressBytes.length < 29) throw new Error('Invalid wallet address bytes');
  const hashes: string[] = [bytesToHex(addressBytes.slice(1, 29))];
  if (addressBytes.length >= 57) hashes.push(bytesToHex(addressBytes.slice(29, 57)));
  return hashes;
};

export const verifyCip30Signature = async (params: VerifyParams): Promise<VerifyResult> => {
  const signedPayloadBytes = hexToBytes(params.signedPayloadHex);
  const sign1Raw = Buffer.from(strip0x(params.coseSign1Hex), 'hex');
  if (sign1Raw.length > MAX_COSE_BYTES) {
    throw new Error('COSE_Sign1 payload exceeds maximum allowed size');
  }
  const sign1 = cbor.decodeFirstSync(sign1Raw);
  if (!Array.isArray(sign1) || sign1.length !== 4) throw new Error('Invalid COSE Sign1 envelope');

  const protectedHeaders = toBytes(sign1[0], 'protected headers in COSE Sign1');
  const payloadFromEnvelope = sign1[2];
  const signature = toBytes(sign1[3], 'Ed25519 signature bytes');
  if (signature.length !== 64) throw new Error('Invalid Ed25519 signature bytes');

  const payloadBytes =
    payloadFromEnvelope == null
      ? signedPayloadBytes
      : payloadFromEnvelope instanceof Uint8Array || Buffer.isBuffer(payloadFromEnvelope) || ArrayBuffer.isView(payloadFromEnvelope)
        ? toBytes(payloadFromEnvelope, 'payload in COSE Sign1')
        : (() => {
            throw new Error('Invalid payload in COSE Sign1');
          })();

  if ((payloadFromEnvelope instanceof Uint8Array || Buffer.isBuffer(payloadFromEnvelope)) && bytesToHex(payloadBytes) !== bytesToHex(signedPayloadBytes)) {
    throw new Error('Signed payload does not match submitted payload');
  }

  const coseKeyRawBytes = Buffer.from(strip0x(params.coseKeyHex), 'hex');
  if (coseKeyRawBytes.length > MAX_COSE_BYTES) {
    throw new Error('COSE key payload exceeds maximum allowed size');
  }
  const coseKeyRaw = cbor.decodeFirstSync(coseKeyRawBytes);
  const publicKey = extractCoseKeyPublicKey(coseKeyRaw);

  const sigStructure = Uint8Array.from(
    cbor.encode(['Signature1', Buffer.from(protectedHeaders), Buffer.alloc(0), Buffer.from(payloadBytes)]),
  );
  const verified = await ed25519.verifyAsync(signature, sigStructure, publicKey);
  if (!verified) throw new Error('CIP-30 signature verification failed');

  const keyHash = blake2b(publicKey, { dkLen: 28 });
  const keyHashHex = bytesToHex(keyHash);
  const walletAddressBytes = decodeAddress(params.walletAddress);
  const candidateHashes = extractCredentialHashes(walletAddressBytes);
  if (!candidateHashes.includes(keyHashHex)) {
    throw new Error('Wallet address does not correspond to signing key');
  }

  return {
    publicKeyHex: bytesToHex(publicKey),
    keyHashHex,
    walletAddressBech32: encodeAddressBech32(params.walletAddress),
  };
};
