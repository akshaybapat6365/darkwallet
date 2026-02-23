import crypto from 'node:crypto';

import type { IntentAction } from '../state/intent-store.js';
import { stableStringify } from '../utils/canonical.js';

const utf8ToHex = (value: string): string => Buffer.from(value, 'utf8').toString('hex');

const hashHex = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

export type IntentTypedPayload = {
  domain: {
    name: 'DarkWallet';
    version: '1';
    chainId: string;
    verifyingService: string;
  };
  types: {
    Intent: Array<{ name: string; type: string }>;
  };
  primaryType: 'Intent';
  message: {
    intentId: string;
    action: IntentAction;
    contractAddress: string;
    rxId: string;
    pharmacyIdHex: string;
    patientPublicKeyHex: string;
    attestationHash: string | null;
    authorizationExpiresAt: string | null;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
  };
};

export type AttestationTypedPayload = {
  domain: {
    name: 'DarkWallet';
    version: '1';
    chainId: string;
    verifyingService: string;
  };
  types: {
    AssetAttestation: Array<{ name: string; type: string }>;
  };
  primaryType: 'AssetAttestation';
  message: {
    challengeId: string;
    nonce: string;
    assetFingerprint: string;
    walletAddress: string | null;
    midnightAddress: string | null;
    issuedAt: string;
    expiresAt: string;
  };
};

export const encodeTypedPayload = (payload: Record<string, unknown>) => {
  const canonicalJson = stableStringify(payload);
  return {
    canonicalJson,
    payloadHex: utf8ToHex(canonicalJson),
    payloadHashHex: hashHex(canonicalJson),
  };
};

export const buildIntentTypedPayload = (params: {
  chainId: string;
  intentId: string;
  action: IntentAction;
  contractAddress: string;
  rxId: string;
  pharmacyIdHex: string;
  patientPublicKeyHex: string;
  attestationHash: string | null;
  authorizationExpiresAt: string | null;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): IntentTypedPayload => ({
  domain: {
    name: 'DarkWallet',
    version: '1',
    chainId: params.chainId,
    verifyingService: 'darkwallet-prover',
  },
  types: {
    Intent: [
      { name: 'intentId', type: 'string' },
      { name: 'action', type: 'string' },
      { name: 'contractAddress', type: 'string' },
      { name: 'rxId', type: 'string' },
      { name: 'pharmacyIdHex', type: 'string' },
      { name: 'patientPublicKeyHex', type: 'string' },
      { name: 'attestationHash', type: 'string' },
      { name: 'authorizationExpiresAt', type: 'string' },
      { name: 'nonce', type: 'string' },
      { name: 'issuedAt', type: 'string' },
      { name: 'expiresAt', type: 'string' },
    ],
  },
  primaryType: 'Intent',
  message: {
    intentId: params.intentId,
    action: params.action,
    contractAddress: params.contractAddress,
    rxId: params.rxId,
    pharmacyIdHex: params.pharmacyIdHex,
    patientPublicKeyHex: params.patientPublicKeyHex,
    attestationHash: params.attestationHash,
    authorizationExpiresAt: params.authorizationExpiresAt,
    nonce: params.nonce,
    issuedAt: params.issuedAt,
    expiresAt: params.expiresAt,
  },
});

export const buildAttestationTypedPayload = (params: {
  chainId: string;
  challengeId: string;
  nonce: string;
  assetFingerprint: string;
  walletAddress: string | null;
  midnightAddress: string | null;
  issuedAt: string;
  expiresAt: string;
}): AttestationTypedPayload => ({
  domain: {
    name: 'DarkWallet',
    version: '1',
    chainId: params.chainId,
    verifyingService: 'darkwallet-prover',
  },
  types: {
    AssetAttestation: [
      { name: 'challengeId', type: 'string' },
      { name: 'nonce', type: 'string' },
      { name: 'assetFingerprint', type: 'string' },
      { name: 'walletAddress', type: 'string' },
      { name: 'midnightAddress', type: 'string' },
      { name: 'issuedAt', type: 'string' },
      { name: 'expiresAt', type: 'string' },
    ],
  },
  primaryType: 'AssetAttestation',
  message: {
    challengeId: params.challengeId,
    nonce: params.nonce,
    assetFingerprint: params.assetFingerprint,
    walletAddress: params.walletAddress,
    midnightAddress: params.midnightAddress,
    issuedAt: params.issuedAt,
    expiresAt: params.expiresAt,
  },
});
