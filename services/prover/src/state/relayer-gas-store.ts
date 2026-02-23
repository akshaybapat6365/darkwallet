import { Pool } from 'pg';

import type { AppConfig } from '../config.js';

export type GasSlotLease = {
  slotId: string;
  slotValueDust: bigint;
  leasedByIntentId: string;
  leasedAt: string;
  leaseExpiresAt: string;
};

export interface RelayerGasStore {
  bootstrap(params: { slotCount: number; slotValueDust: bigint }): Promise<void>;
  lease(params: { intentId: string; leaseTtlMs: number }): Promise<GasSlotLease>;
  release(params: { slotId: string }): Promise<void>;
  close?(): Promise<void>;
}

class InMemoryRelayerGasStore implements RelayerGasStore {
  readonly #slots = new Map<
    string,
    { slotValueDust: bigint; lockedByIntentId: string | null; lockExpiresAtEpochMs: number | null }
  >();

  async bootstrap(params: { slotCount: number; slotValueDust: bigint }): Promise<void> {
    for (let idx = 0; idx < params.slotCount; idx += 1) {
      const slotId = `slot-${String(idx + 1).padStart(3, '0')}`;
      if (!this.#slots.has(slotId)) {
        this.#slots.set(slotId, {
          slotValueDust: params.slotValueDust,
          lockedByIntentId: null,
          lockExpiresAtEpochMs: null,
        });
      }
    }
  }

  async lease(params: { intentId: string; leaseTtlMs: number }): Promise<GasSlotLease> {
    const now = Date.now();
    for (const [slotId, slot] of this.#slots.entries()) {
      const expired = slot.lockExpiresAtEpochMs != null && slot.lockExpiresAtEpochMs <= now;
      if (slot.lockedByIntentId == null || expired) {
        const leaseExpiresAtEpochMs = now + params.leaseTtlMs;
        this.#slots.set(slotId, {
          slotValueDust: slot.slotValueDust,
          lockedByIntentId: params.intentId,
          lockExpiresAtEpochMs: leaseExpiresAtEpochMs,
        });
        return {
          slotId,
          slotValueDust: slot.slotValueDust,
          leasedByIntentId: params.intentId,
          leasedAt: new Date(now).toISOString(),
          leaseExpiresAt: new Date(leaseExpiresAtEpochMs).toISOString(),
        };
      }
    }
    throw new Error('No relayer gas slots available');
  }

  async release(params: { slotId: string }): Promise<void> {
    const slot = this.#slots.get(params.slotId);
    if (!slot) return;
    this.#slots.set(params.slotId, {
      slotValueDust: slot.slotValueDust,
      lockedByIntentId: null,
      lockExpiresAtEpochMs: null,
    });
  }
}

class PgRelayerGasStore implements RelayerGasStore {
  readonly #pool: Pool;

  constructor(databaseUrl: string) {
    this.#pool = new Pool({ connectionString: databaseUrl });
  }

  async init(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS relayer_gas_slots (
        slot_id TEXT PRIMARY KEY,
        slot_value_dust TEXT NOT NULL,
        locked_by_intent_id TEXT,
        lock_expires_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async bootstrap(params: { slotCount: number; slotValueDust: bigint }): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      for (let idx = 0; idx < params.slotCount; idx += 1) {
        const slotId = `slot-${String(idx + 1).padStart(3, '0')}`;
        await client.query(
          `
            INSERT INTO relayer_gas_slots(slot_id, slot_value_dust, locked_by_intent_id, lock_expires_at, updated_at)
            VALUES($1, $2, NULL, NULL, NOW())
            ON CONFLICT(slot_id) DO NOTHING
          `,
          [slotId, params.slotValueDust.toString(10)],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async lease(params: { intentId: string; leaseTtlMs: number }): Promise<GasSlotLease> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const out = await client.query<{
        slot_id: string;
        slot_value_dust: string;
      }>(
        `
          SELECT slot_id, slot_value_dust
          FROM relayer_gas_slots
          WHERE locked_by_intent_id IS NULL OR lock_expires_at < NOW()
          ORDER BY slot_id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `,
      );
      if (out.rows.length === 0) {
        throw new Error('No relayer gas slots available');
      }

      const row = out.rows[0];
      const leaseExpiresAt = new Date(Date.now() + params.leaseTtlMs).toISOString();
      await client.query(
        `
          UPDATE relayer_gas_slots
          SET locked_by_intent_id = $2, lock_expires_at = $3::timestamptz, updated_at = NOW()
          WHERE slot_id = $1
        `,
        [row.slot_id, params.intentId, leaseExpiresAt],
      );
      await client.query('COMMIT');
      return {
        slotId: row.slot_id,
        slotValueDust: BigInt(row.slot_value_dust),
        leasedByIntentId: params.intentId,
        leasedAt: new Date().toISOString(),
        leaseExpiresAt,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async release(params: { slotId: string }): Promise<void> {
    await this.#pool.query(
      `
        UPDATE relayer_gas_slots
        SET locked_by_intent_id = NULL, lock_expires_at = NULL, updated_at = NOW()
        WHERE slot_id = $1
      `,
      [params.slotId],
    );
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export const createRelayerGasStore = async (config: AppConfig): Promise<RelayerGasStore> => {
  if (!config.databaseUrl) return new InMemoryRelayerGasStore();
  const store = new PgRelayerGasStore(config.databaseUrl);
  await store.init();
  return store;
};
