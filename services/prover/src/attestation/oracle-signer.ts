import crypto from 'node:crypto';

import * as ed25519 from '@noble/ed25519';
import { stableStringify } from '../utils/canonical.js';
import { bytesToHex, hexToBytes, strip0x } from '../utils/hex.js';

export type OracleAttestationPayload = {
  cardanoAddress: string;
  assetFingerprint: string;
  midnightAddress: string | null;
  challengeId: string;
  nonce: string;
  verifiedAt: string;
};

export type OracleAttestationEnvelope = {
  algorithm: 'ed25519';
  domainTag: string;
  payload: OracleAttestationPayload;
  payloadHashHex: string;
  publicKeyHex: string;
  signatureHex: string;
};

export type OracleSigner = {
  readonly publicKeyHex: string;
  readonly domainTag: string;
  sign(payload: OracleAttestationPayload): Promise<OracleAttestationEnvelope>;
};

export const hashOraclePayload = (domainTag: string, payload: OracleAttestationPayload): string => {
  const canonical = stableStringify({ domainTag, payload });
  return crypto.createHash('sha256').update(canonical).digest('hex');
};

const normalizePrivateKey = (keyHex: string): Uint8Array => {
  const clean = strip0x(keyHex);
  if (!/^[0-9a-f]{64}$/i.test(clean)) throw new Error('MIDLIGHT_ORACLE_PRIVATE_KEY must be a 32-byte hex string');
  return hexToBytes(clean);
};

const normalizePublicKey = (keyHex: string): string => {
  const clean = strip0x(keyHex);
  if (!/^[0-9a-f]{64}$/i.test(clean)) throw new Error('MIDLIGHT_ORACLE_PUBLIC_KEY must be a 32-byte hex string');
  return clean.toLowerCase();
};

export const createOracleSigner = async (params: {
  domainTag: string;
  privateKeyHex?: string;
  publicKeyHex?: string;
}): Promise<OracleSigner> => {
  let privateKey: Uint8Array | null = null;
  let publicKeyHex = params.publicKeyHex ? normalizePublicKey(params.publicKeyHex) : null;

  if (params.privateKeyHex) {
    privateKey = normalizePrivateKey(params.privateKeyHex);
    const derived = bytesToHex(await ed25519.getPublicKeyAsync(privateKey));
    if (publicKeyHex && publicKeyHex !== derived) {
      throw new Error('MIDLIGHT_ORACLE_PUBLIC_KEY does not match MIDLIGHT_ORACLE_PRIVATE_KEY');
    }
    publicKeyHex = derived;
  }

  if (!privateKey || !publicKeyHex) {
    throw new Error(
      'Oracle signer requires both private and public key material. Set MIDLIGHT_ORACLE_PRIVATE_KEY (and optional matching MIDLIGHT_ORACLE_PUBLIC_KEY).',
    );
  }

  return {
    publicKeyHex,
    domainTag: params.domainTag,
    async sign(payload) {
      const payloadHashHex = hashOraclePayload(params.domainTag, payload);
      const signature = await ed25519.signAsync(hexToBytes(payloadHashHex), privateKey);
      return {
        algorithm: 'ed25519',
        domainTag: params.domainTag,
        payload,
        payloadHashHex,
        publicKeyHex,
        signatureHex: bytesToHex(signature),
      };
    },
  };
};
