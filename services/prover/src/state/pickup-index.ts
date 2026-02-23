import { Pool } from 'pg';

import type { AppConfig } from '../config.js';

export type PickupRecord = {
  contractAddress: string;
  commitmentHex: string;
  expiresAt: string;
  nullifierHex: string | null;
  revokedAt: string | null;
  revokedTxId: string | null;
  revokedBlockHeight: number | null;
  rxId: string;
  pharmacyIdHex: string;
  patientPublicKeyHex: string;
  registeredTxId: string;
  registeredBlockHeight: number;
  redeemedTxId: string | null;
  redeemedBlockHeight: number | null;
  updatedAt: string;
};

export interface PickupIndexStore {
  recordAuthorization(params: {
    contractAddress: string;
    commitmentHex: string;
    expiresAt: string;
    rxId: string;
    pharmacyIdHex: string;
    patientPublicKeyHex: string;
    txId: string;
    blockHeight: number;
  }): Promise<void>;
  recordRevocation(params: {
    contractAddress: string;
    commitmentHex: string;
    txId: string;
    blockHeight: number;
  }): Promise<void>;
  recordRedemption(params: {
    contractAddress: string;
    nullifierHex: string;
    rxId: string;
    pharmacyIdHex: string;
    patientPublicKeyHex: string;
    txId: string;
    blockHeight: number;
  }): Promise<void>;
  list(limit?: number, offset?: number): Promise<PickupRecord[]>;
  close?(): Promise<void>;
}

export class NoopPickupIndexStore implements PickupIndexStore {
  async recordAuthorization(): Promise<void> {}
  async recordRevocation(): Promise<void> {}
  async recordRedemption(): Promise<void> {}
  async list(): Promise<PickupRecord[]> {
    return [];
  }
  async close(): Promise<void> {}
}

export class PgPickupIndexStore implements PickupIndexStore {
  readonly #pool: Pool;

  constructor(databaseUrl: string) {
    this.#pool = new Pool({ connectionString: databaseUrl });
  }

  async init(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS pickup_index (
        commitment_hex TEXT PRIMARY KEY,
        contract_address TEXT NOT NULL,
        nullifier_hex TEXT,
        expires_at TEXT NOT NULL DEFAULT '0',
        revoked_at TIMESTAMPTZ,
        revoked_tx_id TEXT,
        revoked_block_height INTEGER,
        rx_id TEXT NOT NULL,
        pharmacy_id_hex TEXT NOT NULL,
        patient_public_key_hex TEXT NOT NULL,
        registered_tx_id TEXT NOT NULL,
        registered_block_height INTEGER NOT NULL,
        redeemed_tx_id TEXT,
        redeemed_block_height INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.#pool.query(`
      CREATE INDEX IF NOT EXISTS pickup_index_contract_idx ON pickup_index(contract_address, updated_at DESC)
    `);

    await this.#pool.query(`
      ALTER TABLE pickup_index ADD COLUMN IF NOT EXISTS expires_at TEXT NOT NULL DEFAULT '0'
    `);
    await this.#pool.query(`
      ALTER TABLE pickup_index ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ
    `);
    await this.#pool.query(`
      ALTER TABLE pickup_index ADD COLUMN IF NOT EXISTS revoked_tx_id TEXT
    `);
    await this.#pool.query(`
      ALTER TABLE pickup_index ADD COLUMN IF NOT EXISTS revoked_block_height INTEGER
    `);
  }

  async recordAuthorization(params: {
    contractAddress: string;
    commitmentHex: string;
    expiresAt: string;
    rxId: string;
    pharmacyIdHex: string;
    patientPublicKeyHex: string;
    txId: string;
    blockHeight: number;
  }): Promise<void> {
    await this.#pool.query(
      `
        INSERT INTO pickup_index (
          commitment_hex,
          contract_address,
          rx_id,
          pharmacy_id_hex,
          patient_public_key_hex,
          expires_at,
          registered_tx_id,
          registered_block_height,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (commitment_hex)
        DO UPDATE SET
          contract_address = EXCLUDED.contract_address,
          rx_id = EXCLUDED.rx_id,
          pharmacy_id_hex = EXCLUDED.pharmacy_id_hex,
          patient_public_key_hex = EXCLUDED.patient_public_key_hex,
          expires_at = EXCLUDED.expires_at,
          registered_tx_id = EXCLUDED.registered_tx_id,
          registered_block_height = EXCLUDED.registered_block_height,
          revoked_at = NULL,
          revoked_tx_id = NULL,
          revoked_block_height = NULL,
          updated_at = NOW()
      `,
      [
        params.commitmentHex,
        params.contractAddress,
        params.rxId,
        params.pharmacyIdHex,
        params.patientPublicKeyHex,
        params.expiresAt,
        params.txId,
        params.blockHeight,
      ],
    );
  }

  async recordRevocation(params: {
    contractAddress: string;
    commitmentHex: string;
    txId: string;
    blockHeight: number;
  }): Promise<void> {
    await this.#pool.query(
      `
        UPDATE pickup_index
        SET
          revoked_at = NOW(),
          revoked_tx_id = $3,
          revoked_block_height = $4,
          updated_at = NOW()
        WHERE contract_address = $1
          AND commitment_hex = $2
      `,
      [params.contractAddress, params.commitmentHex, params.txId, params.blockHeight],
    );
  }

  async recordRedemption(params: {
    contractAddress: string;
    nullifierHex: string;
    rxId: string;
    pharmacyIdHex: string;
    patientPublicKeyHex: string;
    txId: string;
    blockHeight: number;
  }): Promise<void> {
    await this.#pool.query(
      `
        UPDATE pickup_index
        SET
          nullifier_hex = $2,
          redeemed_tx_id = $3,
          redeemed_block_height = $4,
          updated_at = NOW()
        WHERE contract_address = $1
          AND rx_id = $5
          AND pharmacy_id_hex = $6
          AND patient_public_key_hex = $7
      `,
      [
        params.contractAddress,
        params.nullifierHex,
        params.txId,
        params.blockHeight,
        params.rxId,
        params.pharmacyIdHex,
        params.patientPublicKeyHex,
      ],
    );
  }

  async list(limit = 100, offset = 0): Promise<PickupRecord[]> {
    const out = await this.#pool.query<PickupRecord>(
      `
        SELECT
          contract_address AS "contractAddress",
          commitment_hex AS "commitmentHex",
          expires_at AS "expiresAt",
          nullifier_hex AS "nullifierHex",
          revoked_at AS "revokedAt",
          revoked_tx_id AS "revokedTxId",
          revoked_block_height AS "revokedBlockHeight",
          rx_id AS "rxId",
          pharmacy_id_hex AS "pharmacyIdHex",
          patient_public_key_hex AS "patientPublicKeyHex",
          registered_tx_id AS "registeredTxId",
          registered_block_height AS "registeredBlockHeight",
          redeemed_tx_id AS "redeemedTxId",
          redeemed_block_height AS "redeemedBlockHeight",
          updated_at AS "updatedAt"
        FROM pickup_index
        ORDER BY updated_at DESC
        LIMIT $1
        OFFSET $2
      `,
      [limit, offset],
    );
    return out.rows;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export const createPickupIndexStore = async (config: AppConfig): Promise<PickupIndexStore> => {
  if (!config.databaseUrl) return new NoopPickupIndexStore();
  const pgStore = new PgPickupIndexStore(config.databaseUrl);
  await pgStore.init();
  return pgStore;
};
