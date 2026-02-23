import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { Pool } from 'pg';

import type { AppConfig } from '../config.js';

export type PersistedState = {
  contractAddress?: string;
  clinic?: {
    issuerSecretKeyHex: string;
  };
  patients?: Record<
    string,
    {
      patientSecretKeyHex: string;
      patientPublicKeyHex: string;
    }
  >;
};

const DEFAULT_STATE: PersistedState = {
  patients: {},
};

const ENC_PREFIX = 'enc:v1:';
const ENC_ALGO = 'aes-256-gcm';
const ENC_IV_LENGTH = 12;
const ENC_TAG_LENGTH = 16;

const isEncryptedSecret = (value: string) => value.startsWith(ENC_PREFIX);

const normalizeState = (state: PersistedState): PersistedState => ({
  ...DEFAULT_STATE,
  ...state,
  patients: state.patients ?? {},
});

const normalizeEncryptionKey = (keyHex: string): Buffer => {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error('MIDLIGHT_ENCRYPTION_KEY must be a 32-byte hex string');
  }
  return Buffer.from(keyHex, 'hex');
};

const encryptString = (plaintext: string, keyHex: string): string => {
  const key = normalizeEncryptionKey(keyHex);
  const iv = crypto.randomBytes(ENC_IV_LENGTH);
  const cipher = crypto.createCipheriv(ENC_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
};

const decryptString = (ciphertext: string, keyHex: string): string => {
  const key = normalizeEncryptionKey(keyHex);
  if (!isEncryptedSecret(ciphertext)) return ciphertext;
  const payload = Buffer.from(ciphertext.slice(ENC_PREFIX.length), 'base64');
  const iv = payload.subarray(0, ENC_IV_LENGTH);
  const tag = payload.subarray(ENC_IV_LENGTH, ENC_IV_LENGTH + ENC_TAG_LENGTH);
  const encrypted = payload.subarray(ENC_IV_LENGTH + ENC_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ENC_ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
};

const decryptSecrets = (
  state: PersistedState,
  encryptionKeyHex?: string,
): { state: PersistedState; needsMigration: boolean } => {
  const next = normalizeState(state);
  let needsMigration = false;

  if (next.clinic?.issuerSecretKeyHex) {
    const value = next.clinic.issuerSecretKeyHex;
    if (isEncryptedSecret(value)) {
      if (!encryptionKeyHex) throw new Error('Encrypted state detected but MIDLIGHT_ENCRYPTION_KEY is not configured');
      next.clinic = { issuerSecretKeyHex: decryptString(value, encryptionKeyHex) };
    } else if (encryptionKeyHex) {
      needsMigration = true;
    }
  }

  if (next.patients) {
    const updatedPatients: PersistedState['patients'] = {};
    for (const [patientId, patient] of Object.entries(next.patients)) {
      const value = patient.patientSecretKeyHex;
      if (isEncryptedSecret(value)) {
        if (!encryptionKeyHex) throw new Error('Encrypted state detected but MIDLIGHT_ENCRYPTION_KEY is not configured');
        updatedPatients[patientId] = {
          ...patient,
          patientSecretKeyHex: decryptString(value, encryptionKeyHex),
        };
      } else {
        if (encryptionKeyHex) needsMigration = true;
        updatedPatients[patientId] = patient;
      }
    }
    next.patients = updatedPatients;
  }

  return { state: next, needsMigration };
};

const encryptSecrets = (state: PersistedState, encryptionKeyHex?: string): PersistedState => {
  const next = normalizeState(state);
  if (!encryptionKeyHex) return next;

  if (next.clinic?.issuerSecretKeyHex && !isEncryptedSecret(next.clinic.issuerSecretKeyHex)) {
    next.clinic = {
      issuerSecretKeyHex: encryptString(next.clinic.issuerSecretKeyHex, encryptionKeyHex),
    };
  }

  if (next.patients) {
    const updatedPatients: PersistedState['patients'] = {};
    for (const [patientId, patient] of Object.entries(next.patients)) {
      updatedPatients[patientId] = {
        ...patient,
        patientSecretKeyHex: isEncryptedSecret(patient.patientSecretKeyHex)
          ? patient.patientSecretKeyHex
          : encryptString(patient.patientSecretKeyHex, encryptionKeyHex),
      };
    }
    next.patients = updatedPatients;
  }

  return next;
};

export interface StateStore {
  read(): Promise<PersistedState>;
  write(next: PersistedState): Promise<void>;
  update(fn: (prev: PersistedState) => PersistedState): Promise<PersistedState>;
  close?(): Promise<void>;
}

export class FileStateStore implements StateStore {
  readonly #filePath: string;
  readonly #encryptionKeyHex?: string;

  constructor(filePath: string, encryptionKeyHex?: string) {
    this.#filePath = filePath;
    this.#encryptionKeyHex = encryptionKeyHex;
  }

  async read(): Promise<PersistedState> {
    try {
      const raw = await fs.readFile(this.#filePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedState;
      const decrypted = decryptSecrets(parsed, this.#encryptionKeyHex);
      if (decrypted.needsMigration && this.#encryptionKeyHex) {
        await this.write(decrypted.state);
      }
      return decrypted.state;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_STATE };
      throw e;
    }
  }

  async write(next: PersistedState): Promise<void> {
    await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
    const toPersist = encryptSecrets(next, this.#encryptionKeyHex);
    await fs.writeFile(this.#filePath, JSON.stringify(toPersist, null, 2) + '\n', 'utf8');
  }

  async update(fn: (prev: PersistedState) => PersistedState): Promise<PersistedState> {
    const prev = await this.read();
    const next = fn(prev);
    await this.write(next);
    return next;
  }

  async close(): Promise<void> {}
}

const STATE_KEY = 'prover_state';

export class PgStateStore implements StateStore {
  readonly #pool: Pool;
  readonly #encryptionKeyHex?: string;

  constructor(params: { databaseUrl: string; encryptionKeyHex?: string }) {
    this.#pool = new Pool({ connectionString: params.databaseUrl });
    this.#encryptionKeyHex = params.encryptionKeyHex;
  }

  async init(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        state_key TEXT PRIMARY KEY,
        state_value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async read(): Promise<PersistedState> {
    const out = await this.#pool.query<{ state_value: PersistedState }>(
      'SELECT state_value FROM app_state WHERE state_key = $1 LIMIT 1',
      [STATE_KEY],
    );

    if (out.rows.length === 0) return { ...DEFAULT_STATE };
    const parsed = out.rows[0].state_value as PersistedState;
    const decrypted = decryptSecrets(parsed, this.#encryptionKeyHex);
    if (decrypted.needsMigration && this.#encryptionKeyHex) {
      await this.write(decrypted.state);
    }
    return decrypted.state;
  }

  async write(next: PersistedState): Promise<void> {
    const toPersist = encryptSecrets(next, this.#encryptionKeyHex);
    await this.#pool.query(
      `
        INSERT INTO app_state(state_key, state_value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (state_key)
        DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = NOW()
      `,
      [STATE_KEY, JSON.stringify(toPersist)],
    );
  }

  async update(fn: (prev: PersistedState) => PersistedState): Promise<PersistedState> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const out = await client.query<{ state_value: PersistedState }>(
        'SELECT state_value FROM app_state WHERE state_key = $1 FOR UPDATE',
        [STATE_KEY],
      );

      const prev = out.rows.length === 0
        ? { ...DEFAULT_STATE }
        : decryptSecrets(out.rows[0].state_value, this.#encryptionKeyHex).state;
      const next = fn(prev);
      const toPersist = encryptSecrets(next, this.#encryptionKeyHex);

      await client.query(
        `
          INSERT INTO app_state(state_key, state_value, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (state_key)
          DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = NOW()
        `,
        [STATE_KEY, JSON.stringify(toPersist)],
      );
      await client.query('COMMIT');
      return next;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export const createStateStore = async (config: AppConfig): Promise<StateStore> => {
  if (!config.databaseUrl) {
    return new FileStateStore(config.statePath, config.encryptionKeyHex);
  }

  const pgStore = new PgStateStore({
    databaseUrl: config.databaseUrl,
    encryptionKeyHex: config.encryptionKeyHex,
  });
  await pgStore.init();
  return pgStore;
};
