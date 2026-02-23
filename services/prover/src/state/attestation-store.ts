import { Pool } from 'pg';

import type { AppConfig } from '../config.js';
import type { OracleAttestationEnvelope } from '../attestation/oracle-signer.js';

export type ChallengeStatus = 'pending' | 'verified' | 'expired' | 'failed';

export type AttestationChallenge = {
  challengeId: string;
  nonce: string;
  assetFingerprint: string;
  walletAddressHint: string | null;
  midnightAddressHint: string | null;
  typedPayload: Record<string, unknown>;
  payloadHex: string;
  createdAt: string;
  expiresAt: string;
  status: ChallengeStatus;
};

export type AttestationProof = {
  attestationHash: string;
  challengeId: string;
  walletAddress: string;
  assetFingerprint: string;
  verificationSource: 'blockfrost';
  midnightAddress: string | null;
  oracleEnvelope: OracleAttestationEnvelope;
  verifiedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export interface AttestationStore {
  createChallenge(challenge: AttestationChallenge): Promise<void>;
  getChallenge(challengeId: string): Promise<AttestationChallenge | null>;
  setChallengeStatus(challengeId: string, status: ChallengeStatus): Promise<void>;
  createProof(proof: AttestationProof): Promise<void>;
  getProof(attestationHash: string): Promise<AttestationProof | null>;
  close?(): Promise<void>;
}

export class InMemoryAttestationStore implements AttestationStore {
  readonly #challenges = new Map<string, AttestationChallenge>();
  readonly #proofs = new Map<string, AttestationProof>();

  async createChallenge(challenge: AttestationChallenge): Promise<void> {
    this.#challenges.set(challenge.challengeId, challenge);
  }

  async getChallenge(challengeId: string): Promise<AttestationChallenge | null> {
    return this.#challenges.get(challengeId) ?? null;
  }

  async setChallengeStatus(challengeId: string, status: ChallengeStatus): Promise<void> {
    const existing = this.#challenges.get(challengeId);
    if (!existing) return;
    this.#challenges.set(challengeId, { ...existing, status });
  }

  async createProof(proof: AttestationProof): Promise<void> {
    this.#proofs.set(proof.attestationHash, proof);
  }

  async getProof(attestationHash: string): Promise<AttestationProof | null> {
    return this.#proofs.get(attestationHash) ?? null;
  }

  async close(): Promise<void> {}
}

export class PgAttestationStore implements AttestationStore {
  readonly #pool: Pool;

  constructor(databaseUrl: string) {
    this.#pool = new Pool({ connectionString: databaseUrl });
  }

  async init(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS attestation_challenges (
        challenge_id TEXT PRIMARY KEY,
        nonce TEXT NOT NULL,
        asset_fingerprint TEXT NOT NULL,
        wallet_address_hint TEXT,
        midnight_address_hint TEXT,
        typed_payload JSONB NOT NULL,
        payload_hex TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL
      )
    `);

    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS attestation_proofs (
        attestation_hash TEXT PRIMARY KEY,
        challenge_id TEXT NOT NULL REFERENCES attestation_challenges(challenge_id),
        wallet_address TEXT NOT NULL,
        asset_fingerprint TEXT NOT NULL,
        verification_source TEXT NOT NULL,
        midnight_address TEXT,
        oracle_envelope JSONB NOT NULL,
        verified_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ
      )
    `);

    // Backfill support for existing DBs created before oracle envelopes.
    await this.#pool.query(`ALTER TABLE attestation_challenges ADD COLUMN IF NOT EXISTS midnight_address_hint TEXT`);
    await this.#pool.query(`ALTER TABLE attestation_proofs ADD COLUMN IF NOT EXISTS midnight_address TEXT`);
    await this.#pool.query(`ALTER TABLE attestation_proofs ADD COLUMN IF NOT EXISTS oracle_envelope JSONB`);
    await this.#pool.query(`UPDATE attestation_proofs SET oracle_envelope = '{}'::jsonb WHERE oracle_envelope IS NULL`);
    await this.#pool.query(`ALTER TABLE attestation_proofs ALTER COLUMN oracle_envelope SET NOT NULL`);
  }

  async createChallenge(challenge: AttestationChallenge): Promise<void> {
    await this.#pool.query(
      `
        INSERT INTO attestation_challenges(
          challenge_id, nonce, asset_fingerprint, wallet_address_hint, midnight_address_hint, typed_payload, payload_hex, created_at, expires_at, status
        )
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::timestamptz,$9::timestamptz,$10)
      `,
      [
        challenge.challengeId,
        challenge.nonce,
        challenge.assetFingerprint,
        challenge.walletAddressHint,
        challenge.midnightAddressHint,
        JSON.stringify(challenge.typedPayload),
        challenge.payloadHex,
        challenge.createdAt,
        challenge.expiresAt,
        challenge.status,
      ],
    );
  }

  async getChallenge(challengeId: string): Promise<AttestationChallenge | null> {
    const out = await this.#pool.query<{
      challenge_id: string;
      nonce: string;
      asset_fingerprint: string;
      wallet_address_hint: string | null;
      midnight_address_hint: string | null;
      typed_payload: Record<string, unknown>;
      payload_hex: string;
      created_at: string;
      expires_at: string;
      status: ChallengeStatus;
    }>(
      `
        SELECT challenge_id, nonce, asset_fingerprint, wallet_address_hint, midnight_address_hint, typed_payload, payload_hex, created_at, expires_at, status
        FROM attestation_challenges
        WHERE challenge_id = $1
        LIMIT 1
      `,
      [challengeId],
    );

    if (out.rows.length === 0) return null;
    const row = out.rows[0];
    return {
      challengeId: row.challenge_id,
      nonce: row.nonce,
      assetFingerprint: row.asset_fingerprint,
      walletAddressHint: row.wallet_address_hint,
      midnightAddressHint: row.midnight_address_hint,
      typedPayload: row.typed_payload,
      payloadHex: row.payload_hex,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      status: row.status,
    };
  }

  async setChallengeStatus(challengeId: string, status: ChallengeStatus): Promise<void> {
    await this.#pool.query(`UPDATE attestation_challenges SET status = $2 WHERE challenge_id = $1`, [challengeId, status]);
  }

  async createProof(proof: AttestationProof): Promise<void> {
    await this.#pool.query(
      `
        INSERT INTO attestation_proofs(
          attestation_hash, challenge_id, wallet_address, asset_fingerprint, verification_source, midnight_address, oracle_envelope, verified_at, expires_at, revoked_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,$9::timestamptz,$10::timestamptz)
      `,
      [
        proof.attestationHash,
        proof.challengeId,
        proof.walletAddress,
        proof.assetFingerprint,
        proof.verificationSource,
        proof.midnightAddress,
        JSON.stringify(proof.oracleEnvelope),
        proof.verifiedAt,
        proof.expiresAt,
        proof.revokedAt,
      ],
    );
  }

  async getProof(attestationHash: string): Promise<AttestationProof | null> {
    const out = await this.#pool.query<{
      attestation_hash: string;
      challenge_id: string;
      wallet_address: string;
      asset_fingerprint: string;
      verification_source: 'blockfrost';
      midnight_address: string | null;
      oracle_envelope: OracleAttestationEnvelope;
      verified_at: string;
      expires_at: string;
      revoked_at: string | null;
    }>(
      `
        SELECT attestation_hash, challenge_id, wallet_address, asset_fingerprint, verification_source, midnight_address, oracle_envelope, verified_at, expires_at, revoked_at
        FROM attestation_proofs
        WHERE attestation_hash = $1
        LIMIT 1
      `,
      [attestationHash],
    );
    if (out.rows.length === 0) return null;
    const row = out.rows[0];
    return {
      attestationHash: row.attestation_hash,
      challengeId: row.challenge_id,
      walletAddress: row.wallet_address,
      assetFingerprint: row.asset_fingerprint,
      verificationSource: row.verification_source,
      midnightAddress: row.midnight_address,
      oracleEnvelope: row.oracle_envelope,
      verifiedAt: row.verified_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export const createAttestationStore = async (config: AppConfig): Promise<AttestationStore> => {
  if (!config.databaseUrl) return new InMemoryAttestationStore();
  const pg = new PgAttestationStore(config.databaseUrl);
  await pg.init();
  return pg;
};
