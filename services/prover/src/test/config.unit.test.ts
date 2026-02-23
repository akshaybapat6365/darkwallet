import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { logger } from '../logger.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..', '..', '..', '..');

const clearEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith('DARKWALLET_') ||
      key.startsWith('MIDLIGHT_') ||
      key.startsWith('MIDNIGHT_') ||
      key.startsWith('ATTESTATION_') ||
      key === 'BLOCKFROST_PROJECT_ID' ||
      key === 'BLOCKFROST_BASE_URL' ||
      key === 'PORT'
    ) {
      delete process.env[key];
    }
  }
};

describe('config compatibility aliases', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('prefers DARKWALLET_* over legacy MIDLIGHT_* aliases', () => {
    process.env.MIDNIGHT_NETWORK = 'standalone';
    process.env.DARKWALLET_API_SECRET = 'darkwallet-secret';
    process.env.MIDLIGHT_API_SECRET = 'legacy-secret';

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const config = loadConfig(repoRoot);

    expect(config.apiSecret).toBe('darkwallet-secret');
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ legacyName: 'MIDLIGHT_API_SECRET' }),
      expect.any(String),
    );
  });

  it('falls back to MIDLIGHT_* and logs deprecation warning', () => {
    process.env.MIDNIGHT_NETWORK = 'standalone';
    process.env.MIDLIGHT_REDIS_URL = 'redis://legacy-host:6379';

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const config = loadConfig(repoRoot);

    expect(config.redisUrl).toBe('redis://legacy-host:6379');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ legacyName: 'MIDLIGHT_REDIS_URL', modernName: 'DARKWALLET_REDIS_URL' }),
      'Legacy environment variable is deprecated',
    );
  });

  it('enforces mainnet required values when aliases are missing', () => {
    process.env.MIDNIGHT_NETWORK = 'mainnet';
    process.env.BLOCKFROST_PROJECT_ID = 'bf-project';
    process.env.MIDNIGHT_WALLET_SEED = '11'.repeat(32);

    expect(() => loadConfig(repoRoot)).toThrow(/MIDLIGHT_DATABASE_URL \(or DARKWALLET_DATABASE_URL\) is required for mainnet/i);
  });
});
