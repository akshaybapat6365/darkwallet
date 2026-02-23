import { EXTENSION_STORAGE_KEYS, RUNTIME_CONFIG } from '../config';
import { deriveCardanoAddressHint, deriveMidnightAddressHint } from '../crypto/hd-wallet';
import { decryptString, encryptString, type EncryptedPayloadV1 } from '../crypto/keystore';
import { generateMnemonic24, validateMnemonic } from '../crypto/mnemonic';

export type VaultRecordV1 = {
  version: 1;
  encryptedMnemonic: EncryptedPayloadV1;
  cardanoAddressHint: string;
  midnightAddressHint: string;
  createdAt: string;
};

export type VaultSession = {
  mnemonic: string;
  cardanoAddress: string;
  midnightAddress: string;
  unlockedAt: number;
  autoLockAt: number;
};

const getVaultRecord = async (): Promise<VaultRecordV1 | null> => {
  const raw = await chrome.storage.local.get(EXTENSION_STORAGE_KEYS.vault);
  return (raw[EXTENSION_STORAGE_KEYS.vault] as VaultRecordV1 | undefined) ?? null;
};

const setVaultRecord = async (record: VaultRecordV1): Promise<void> => {
  await chrome.storage.local.set({ [EXTENSION_STORAGE_KEYS.vault]: record });
};

export const vaultExists = async (): Promise<boolean> => Boolean(await getVaultRecord());

export const createVault = async (password: string, mnemonic?: string): Promise<{ record: VaultRecordV1; mnemonic: string }> => {
  const phrase = (mnemonic ?? generateMnemonic24()).trim();
  if (!validateMnemonic(phrase)) throw new Error('Invalid mnemonic');
  const encryptedMnemonic = await encryptString(phrase, password);
  const [cardanoAddressHint, midnightAddressHint] = await Promise.all([
    deriveCardanoAddressHint(phrase),
    deriveMidnightAddressHint(phrase),
  ]);
  const record: VaultRecordV1 = {
    version: 1,
    encryptedMnemonic,
    cardanoAddressHint,
    midnightAddressHint,
    createdAt: new Date().toISOString(),
  };
  await setVaultRecord(record);
  return { record, mnemonic: phrase };
};

export const unlockVault = async (password: string): Promise<VaultSession> => {
  const record = await getVaultRecord();
  if (!record) throw new Error('Vault not initialized');
  const mnemonic = await decryptString(record.encryptedMnemonic, password);
  const autoLockAt = Date.now() + RUNTIME_CONFIG.autoLockMinutes * 60_000;
  return {
    mnemonic,
    cardanoAddress: record.cardanoAddressHint,
    midnightAddress: record.midnightAddressHint,
    unlockedAt: Date.now(),
    autoLockAt,
  };
};

export const readVaultHints = async (): Promise<{ cardanoAddress: string; midnightAddress: string } | null> => {
  const record = await getVaultRecord();
  if (!record) return null;
  return {
    cardanoAddress: record.cardanoAddressHint,
    midnightAddress: record.midnightAddressHint,
  };
};
