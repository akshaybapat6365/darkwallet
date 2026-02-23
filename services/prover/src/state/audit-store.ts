import { Pool } from 'pg';

import type { AppConfig } from '../config.js';

export type AuditRecord = {
  requestId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export interface AuditStore {
  record(entry: AuditRecord): Promise<void>;
  close?(): Promise<void>;
}

class NoopAuditStore implements AuditStore {
  async record(): Promise<void> {}
  async close(): Promise<void> {}
}

class PgAuditStore implements AuditStore {
  readonly #pool: Pool;

  constructor(databaseUrl: string) {
    this.#pool = new Pool({ connectionString: databaseUrl });
  }

  async init(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        request_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.#pool.query(`
      CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at DESC)
    `);
  }

  async record(entry: AuditRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO audit_logs(request_id, event_type, payload, created_at) VALUES ($1,$2,$3::jsonb,$4::timestamptz)`,
      [entry.requestId, entry.eventType, JSON.stringify(entry.payload), entry.createdAt],
    );
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export const createAuditStore = async (config: AppConfig): Promise<AuditStore> => {
  if (!config.databaseUrl) return new NoopAuditStore();
  const pg = new PgAuditStore(config.databaseUrl);
  await pg.init();
  return pg;
};
