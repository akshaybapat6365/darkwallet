import crypto from 'node:crypto';

import type { Network } from '../config.js';
import { buildAttestationTypedPayload, encodeTypedPayload } from '../intents/typed-intent.js';
import type { OracleSigner } from './oracle-signer.js';
import type { AttestationProof, AttestationStore } from '../state/attestation-store.js';
import { verifyCip30Signature } from './cip30-verify.js';
import type { BlockfrostClient } from './blockfrost-client.js';

type CreateChallengeParams = {
  assetFingerprint: string;
  walletAddress: string | null;
  midnightAddress: string | null;
};

type VerifyChallengeParams = {
  challengeId: string;
  walletAddress: string;
  midnightAddress: string | null;
  signedPayloadHex: string;
  coseSign1Hex: string;
  coseKeyHex: string;
  assetFingerprint: string;
};

export type AttestationServiceConfig = {
  network: Network;
  ttlMs: number;
  maxClockSkewMs: number;
  proofValidityMs?: number;
  minL1AdaLovelace?: bigint;
};

export class AttestationService {
  readonly #store: AttestationStore;
  readonly #blockfrost: BlockfrostClient | null;
  readonly #oracleSigner: OracleSigner;
  readonly #config: AttestationServiceConfig;

  constructor(params: {
    store: AttestationStore;
    blockfrost: BlockfrostClient | null;
    oracleSigner: OracleSigner;
    config: AttestationServiceConfig;
  }) {
    this.#store = params.store;
    this.#blockfrost = params.blockfrost;
    this.#oracleSigner = params.oracleSigner;
    this.#config = params.config;
  }

  #requireBlockfrost(): BlockfrostClient {
    if (this.#blockfrost) return this.#blockfrost;
    const err = new Error('Attestation verification unavailable: BLOCKFROST_PROJECT_ID is not configured') as Error & {
      statusCode?: number;
    };
    err.statusCode = 503;
    throw err;
  }

  async createChallenge(params: CreateChallengeParams) {
    const challengeId = crypto.randomUUID();
    const nonce = crypto.randomBytes(16).toString('hex');
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.#config.ttlMs).toISOString();

    const typedPayload = buildAttestationTypedPayload({
      chainId: this.#config.network,
      challengeId,
      nonce,
      assetFingerprint: params.assetFingerprint,
      walletAddress: params.walletAddress,
      midnightAddress: params.midnightAddress,
      issuedAt,
      expiresAt,
    });

    const { canonicalJson, payloadHex } = encodeTypedPayload(typedPayload as unknown as Record<string, unknown>);
    await this.#store.createChallenge({
      challengeId,
      nonce,
      assetFingerprint: params.assetFingerprint,
      walletAddressHint: params.walletAddress,
      midnightAddressHint: params.midnightAddress,
      typedPayload: typedPayload as unknown as Record<string, unknown>,
      payloadHex,
      createdAt: issuedAt,
      expiresAt,
      status: 'pending',
    });

    return {
      challengeId,
      nonce,
      message: canonicalJson,
      typedPayload,
      payloadHex,
      expiresAt,
    };
  }

  async verifyChallenge(params: VerifyChallengeParams) {
    const challenge = await this.#store.getChallenge(params.challengeId);
    if (!challenge) throw new Error('Unknown challengeId');
    if (challenge.status !== 'pending') throw new Error(`Challenge is not pending (${challenge.status})`);
    if (challenge.assetFingerprint !== params.assetFingerprint) throw new Error('assetFingerprint does not match challenge');

    const expiresAtMs = Date.parse(challenge.expiresAt);
    if (Number.isNaN(expiresAtMs)) throw new Error('Challenge expiry is invalid');
    if (Date.now() > expiresAtMs + this.#config.maxClockSkewMs) {
      await this.#store.setChallengeStatus(params.challengeId, 'expired');
      throw new Error('Challenge expired');
    }

    const verifyResult = await verifyCip30Signature({
      walletAddress: params.walletAddress,
      signedPayloadHex: params.signedPayloadHex,
      coseSign1Hex: params.coseSign1Hex,
      coseKeyHex: params.coseKeyHex,
    });

    if (challenge.walletAddressHint && challenge.walletAddressHint !== verifyResult.walletAddressBech32) {
      throw new Error('Wallet address does not match the challenge wallet hint');
    }
    if (challenge.midnightAddressHint && params.midnightAddress && challenge.midnightAddressHint !== params.midnightAddress) {
      throw new Error('Midnight address does not match the challenge midnightAddress hint');
    }

    if (challenge.payloadHex !== params.signedPayloadHex.replace(/^0x/i, '')) {
      throw new Error('Submitted signed payload does not match challenge payload');
    }

    const minAda = this.#config.minL1AdaLovelace ?? 0n;
    const blockfrost = this.#requireBlockfrost();
    if (minAda > 0n) {
      await blockfrost.assertMinimumAdaBalance({
        walletAddress: verifyResult.walletAddressBech32,
        minimumLovelace: minAda,
      });
    }

    const ownership = await blockfrost.assertAssetOwnership({
      assetFingerprint: params.assetFingerprint,
      walletAddress: verifyResult.walletAddressBech32,
    });

    const proofValidityMs = this.#config.proofValidityMs ?? 24 * 60 * 60 * 1000;
    const verifiedAt = new Date().toISOString();
    const proofExpiresAt = new Date(Date.now() + proofValidityMs).toISOString();
    const oracleEnvelope = await this.#oracleSigner.sign({
      cardanoAddress: verifyResult.walletAddressBech32,
      assetFingerprint: params.assetFingerprint,
      midnightAddress: params.midnightAddress ?? challenge.midnightAddressHint ?? null,
      challengeId: params.challengeId,
      nonce: challenge.nonce,
      verifiedAt,
    });
    const attestationHash = crypto
      .createHash('sha256')
      .update(
        `${params.challengeId}|${verifyResult.walletAddressBech32}|${params.assetFingerprint}|${oracleEnvelope.payloadHashHex}|${oracleEnvelope.signatureHex}`,
      )
      .digest('hex');

    const proof: AttestationProof = {
      attestationHash,
      challengeId: params.challengeId,
      walletAddress: verifyResult.walletAddressBech32,
      assetFingerprint: params.assetFingerprint,
      verificationSource: 'blockfrost',
      midnightAddress: params.midnightAddress ?? challenge.midnightAddressHint ?? null,
      oracleEnvelope,
      verifiedAt,
      expiresAt: proofExpiresAt,
      revokedAt: null,
    };

    await this.#store.createProof(proof);
    await this.#store.setChallengeStatus(params.challengeId, 'verified');

    return {
      attestationHash,
      verified: true as const,
      source: 'blockfrost' as const,
      quantity: ownership.quantity,
      walletAddress: verifyResult.walletAddressBech32,
      keyHashHex: verifyResult.keyHashHex,
      oracleEnvelope,
      expiresAt: proofExpiresAt,
    };
  }

  async getAttestation(attestationHash: string) {
    return await this.#store.getProof(attestationHash);
  }

  async requireValidAttestation(params: {
    attestationHash: string;
    walletAddress?: string;
    assetFingerprint?: string;
    midnightAddress?: string;
  }) {
    const proof = await this.#store.getProof(params.attestationHash);
    if (!proof) throw new Error('Attestation not found');
    if (proof.revokedAt) throw new Error('Attestation is revoked');
    if (Date.now() > Date.parse(proof.expiresAt) + this.#config.maxClockSkewMs) throw new Error('Attestation expired');
    if (params.walletAddress && proof.walletAddress !== params.walletAddress) throw new Error('Attestation wallet mismatch');
    if (params.assetFingerprint && proof.assetFingerprint !== params.assetFingerprint) throw new Error('Attestation asset mismatch');
    if (params.midnightAddress && proof.midnightAddress !== params.midnightAddress) {
      throw new Error('Attestation midnight address mismatch');
    }
    return proof;
  }
}
