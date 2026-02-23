import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileStateStore } from '../state/store.js';

const encryptionKey = 'a'.repeat(64);

const makeFixtureState = () => ({
  contractAddress: '0xabc',
  clinic: { issuerSecretKeyHex: '11'.repeat(32) },
  patients: {
    p1: {
      patientSecretKeyHex: '22'.repeat(32),
      patientPublicKeyHex: '33'.repeat(32),
    },
  },
});

describe('file state store encryption', () => {
  it('encrypts secrets on write and decrypts on read', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'midlight-store-'));
    const filePath = path.join(tempDir, 'state.json');
    const store = new FileStateStore(filePath, encryptionKey);

    await store.write(makeFixtureState());
    const raw = await fs.readFile(filePath, 'utf8');
    expect(raw).not.toContain('11'.repeat(32));
    expect(raw).not.toContain('22'.repeat(32));
    expect(raw).toContain('enc:v1:');

    const roundTrip = await store.read();
    expect(roundTrip.clinic?.issuerSecretKeyHex).toBe('11'.repeat(32));
    expect(roundTrip.patients?.p1.patientSecretKeyHex).toBe('22'.repeat(32));
  });

  it('auto-migrates plaintext secrets on first read', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'midlight-store-migrate-'));
    const filePath = path.join(tempDir, 'state.json');
    const plaintextState = makeFixtureState();
    await fs.writeFile(filePath, JSON.stringify(plaintextState, null, 2), 'utf8');

    const store = new FileStateStore(filePath, encryptionKey);
    const readState = await store.read();
    expect(readState.clinic?.issuerSecretKeyHex).toBe(plaintextState.clinic.issuerSecretKeyHex);
    expect(readState.patients?.p1.patientSecretKeyHex).toBe(plaintextState.patients.p1.patientSecretKeyHex);

    const migratedRaw = await fs.readFile(filePath, 'utf8');
    expect(migratedRaw).toContain('enc:v1:');
    expect(migratedRaw).not.toContain(plaintextState.clinic.issuerSecretKeyHex);
    expect(migratedRaw).not.toContain(plaintextState.patients.p1.patientSecretKeyHex);
  });
});
