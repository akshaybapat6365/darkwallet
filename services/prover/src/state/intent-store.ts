import crypto from 'node:crypto';

import { Pool } from 'pg';

import type { AppConfig } from '../config.js';

export type IntentAction = 'registerAuthorization' | 'redeem';

export type PreparedIntent = {
  intentId: string;
  action: IntentAction;
  chainId: string;
  walletAddressHint: string | null;
  nonce: string;
  gasSlotId: string | null;
  issuedAt: string;
  expiresAt: string;
  typedPayload: Record<string, unknown>;
  payloadHex: string;
  requestBody: Record<string, unknown>;
  status: 'prepared' | 'submitted' | 'expired' | 'failed';
};

export interface IntentStore {
  createPreparedIntent(intent: PreparedIntent): Promise<void>;
  getPreparedIntent(intentId: string): Promise<PreparedIntent | null>;
  setIntentGasSlot(intentId: string, gasSlotId: string | null): Promise<void>;
  setIntentStatus(intentId: string, status: PreparedIntent['status']): Promise<void>;
  claimNonce(params: { walletAddress: string; nonce: string; action: IntentAction; chainId: string; intentId: string }): Promise<void>;
  close?(): Promise<void>;
}

class InMemoryIntentStore implements IntentStore {
  readonly #intents = new Map<string, PreparedIntent>();
  readonly #nonces = new Set<string>();

  async createPreparedIntent(intent: PreparedIntent): Promise<void> {
    this.#intents.set(intent.intentId, intent);
  }

  async getPreparedIntent(intentId: string): Promise<PreparedIntent | null> {
    return this.#intents.get(intentId) ?? null;
  }

  async setIntentStatus(intentId: string, status: PreparedIntent['status']): Promise<void> {
    const existing = this.#intents.get(intentId);
    if (!existing) return;
    this.#intents.set(intentId, { ...existing, status });
  }

  async setIntentGasSlot(intentId: string, gasSlotId: string | null): Promise<void> {
    const existing = this.#intents.get(intentId);
    if (!existing) return;
    this.#intents.set(intentId, { ...existing, gasSlotId });
  }

  async claimNonce(params: { walletAddress: string; nonce: string; action: IntentAction; chainId: string; intentId: string }): Promise<void> {
    const key = `${params.walletAddress}|${params.nonce}|${params.action}|${params.chainId}`;
    if (this.#nonces.has(key)) throw new Error('Intent nonce replay detected');
    this.#nonces.add(key);
  }

  async close(): Promise<void> {}
}

class PgIntentStore implements IntentStore {
  readonly #pool: Pool;

  constructor(databaseUrl: string) {
    this.#pool = new Pool({ connectionString: databaseUrl });
  }

  async init(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS prepared_intents (
        intent_id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        wallet_address_hint TEXT,
        nonce TEXT NOT NULL,
        gas_slot_id TEXT,
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        typed_payload JSONB NOT NULL,
        payload_hex TEXT NOT NULL,
        request_body JSONB NOT NULL,
        status TEXT NOT NULL
      )
    `);

    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS intent_nonces (
        nonce_id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        nonce TEXT NOT NULL,
        action TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        intent_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(wallet_address, nonce, action, chain_id)
      )
    `);

    await this.#pool.query(`ALTER TABLE prepared_intents ADD COLUMN IF NOT EXISTS gas_slot_id TEXT`);
  }

  async createPreparedIntent(intent: PreparedIntent): Promise<void> {
    await this.#pool.query(
      `
        INSERT INTO prepared_intents(
          intent_id, action, chain_id, wallet_address_hint, nonce, gas_slot_id, issued_at, expires_at, typed_payload, payload_hex, request_body, status
        )
        VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9::jsonb,$10,$11::jsonb,$12)
      `,
      [
        intent.intentId,
        intent.action,
        intent.chainId,
        intent.walletAddressHint,
        intent.nonce,
        intent.gasSlotId,
        intent.issuedAt,
        intent.expiresAt,
        JSON.stringify(intent.typedPayload),
        intent.payloadHex,
        JSON.stringify(intent.requestBody),
        intent.status,
      ],
    );
  }

  async getPreparedIntent(intentId: string): Promise<PreparedIntent | null> {
    const out = await this.#pool.query<{
      intent_id: string;
      action: IntentAction;
      chain_id: string;
      wallet_address_hint: string | null;
      nonce: string;
      gas_slot_id: string | null;
      issued_at: string;
      expires_at: string;
      typed_payload: Record<string, unknown>;
      payload_hex: string;
      request_body: Record<string, unknown>;
      status: PreparedIntent['status'];
    }>(
      `
        SELECT intent_id, action, chain_id, wallet_address_hint, nonce, gas_slot_id, issued_at, expires_at, typed_payload, payload_hex, request_body, status
        FROM prepared_intents
        WHERE intent_id = $1
        LIMIT 1
      `,
      [intentId],
    );
    if (out.rows.length === 0) return null;
    const row = out.rows[0];
    return {
      intentId: row.intent_id,
      action: row.action,
      chainId: row.chain_id,
      walletAddressHint: row.wallet_address_hint,
      nonce: row.nonce,
      gasSlotId: row.gas_slot_id,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      typedPayload: row.typed_payload,
      payloadHex: row.payload_hex,
      requestBody: row.request_body,
      status: row.status,
    };
  }

  async setIntentStatus(intentId: string, status: PreparedIntent['status']): Promise<void> {
    await this.#pool.query(`UPDATE prepared_intents SET status = $2 WHERE intent_id = $1`, [intentId, status]);
  }

  async setIntentGasSlot(intentId: string, gasSlotId: string | null): Promise<void> {
    await this.#pool.query(`UPDATE prepared_intents SET gas_slot_id = $2 WHERE intent_id = $1`, [intentId, gasSlotId]);
  }

  async claimNonce(params: { walletAddress: string; nonce: string; action: IntentAction; chainId: string; intentId: string }): Promise<void> {
    try {
      await this.#pool.query(
        `
          INSERT INTO intent_nonces(nonce_id, wallet_address, nonce, action, chain_id, intent_id)
          VALUES($1,$2,$3,$4,$5,$6)
        `,
        [crypto.randomUUID(), params.walletAddress, params.nonce, params.action, params.chainId, params.intentId],
      );
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === '23505') throw new Error('Intent nonce replay detected');
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export const createIntentStore = async (config: AppConfig): Promise<IntentStore> => {
  if (!config.databaseUrl) return new InMemoryIntentStore();
  const pg = new PgIntentStore(config.databaseUrl);
  await pg.init();
  return pg;
};
