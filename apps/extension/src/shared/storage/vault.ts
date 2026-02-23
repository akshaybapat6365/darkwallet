import { EXTENSION_STORAGE_KEYS, RUNTIME_CONFIG } from '../config';
import { deriveCardanoWallet, deriveMidnightAddressHint, type CardanoNetwork } from '../crypto/hd-wallet';
import { decryptString, encryptString, type EncryptedPayloadV1 } from '../crypto/keystore';
import { generateMnemonic24, validateMnemonic } from '../crypto/mnemonic';

export type VaultRecordV1 = {
  version: 1;
  encryptedMnemonic: EncryptedPayloadV1;
  cardanoAddressHint: string;
  midnightAddressHint: string;
  createdAt: string;
};

export type VaultCardanoRecordV2 = {
  network: CardanoNetwork;
  accountIndex: number;
  externalIndex: number;
  changeIndex: number;
  stakeIndex: number;
  paymentAddress: string;
  changeAddress: string;
  rewardAddress: string;
  paymentPublicKeyHex: string;
  stakePublicKeyHex: string;
  paymentKeyHashHex: string;
  stakeKeyHashHex: string;
};

export type VaultRecordV2 = {
  version: 2;
  encryptedMnemonic: EncryptedPayloadV1;
  cardano: VaultCardanoRecordV2;
  midnightAddressHint: string;
  createdAt: string;
};

type VaultRecord = VaultRecordV1 | VaultRecordV2;

export type VaultSession = {
  mnemonic: string;
  cardanoAddress: string;
  cardanoChangeAddress: string;
  cardanoRewardAddress: string;
  cardanoNetwork: CardanoNetwork;
  cardanoAccountIndex: number;
  cardanoExternalIndex: number;
  cardanoStakeIndex: number;
  cardanoPaymentKeyHashHex: string;
  cardanoStakeKeyHashHex: string;
  midnightAddress: string;
  unlockedAt: number;
  autoLockAt: number;
};

const getVaultRecord = async (): Promise<VaultRecord | null> => {
  const raw = await chrome.storage.local.get(EXTENSION_STORAGE_KEYS.vault);
  return (raw[EXTENSION_STORAGE_KEYS.vault] as VaultRecord | undefined) ?? null;
};

const setVaultRecord = async (record: VaultRecord): Promise<void> => {
  await chrome.storage.local.set({ [EXTENSION_STORAGE_KEYS.vault]: record });
};

export const vaultExists = async (): Promise<boolean> => Boolean(await getVaultRecord());

const toCardanoRecordV2 = async (
  mnemonic: string,
  network: CardanoNetwork,
  accountIndex = 0,
): Promise<VaultCardanoRecordV2> => {
  const derived = await deriveCardanoWallet({
    mnemonic,
    network,
    accountIndex,
    externalIndex: 0,
    changeIndex: 0,
    stakeIndex: 0,
  });

  return {
    network: derived.network,
    accountIndex: derived.paths.accountIndex,
    externalIndex: derived.paths.externalIndex,
    changeIndex: derived.paths.changeIndex,
    stakeIndex: derived.paths.stakeIndex,
    paymentAddress: derived.paymentAddress,
    changeAddress: derived.changeAddress,
    rewardAddress: derived.rewardAddress,
    paymentPublicKeyHex: derived.paymentPublicKeyHex,
    stakePublicKeyHex: derived.stakePublicKeyHex,
    paymentKeyHashHex: derived.paymentKeyHashHex,
    stakeKeyHashHex: derived.stakeKeyHashHex,
  };
};

const normalizeRecord = async (record: VaultRecord, mnemonic: string): Promise<VaultRecordV2> => {
  if (record.version === 2) return record;

  const cardano = await toCardanoRecordV2(mnemonic, RUNTIME_CONFIG.network, 0);
  return {
    version: 2,
    encryptedMnemonic: record.encryptedMnemonic,
    cardano,
    midnightAddressHint: record.midnightAddressHint,
    createdAt: record.createdAt,
  };
};

export const createVault = async (password: string, mnemonic?: string): Promise<{ record: VaultRecordV2; mnemonic: string }> => {
  const phrase = (mnemonic ?? generateMnemonic24()).trim();
  if (!validateMnemonic(phrase)) throw new Error('Invalid mnemonic');
  const encryptedMnemonic = await encryptString(phrase, password);
  const [cardano, midnightAddressHint] = await Promise.all([
    toCardanoRecordV2(phrase, RUNTIME_CONFIG.network, 0),
    deriveMidnightAddressHint(phrase),
  ]);
  const record: VaultRecordV2 = {
    version: 2,
    encryptedMnemonic,
    cardano,
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
  const normalized = await normalizeRecord(record, mnemonic);
  if (normalized.version !== record.version) {
    await setVaultRecord(normalized);
  }

  const autoLockAt = Date.now() + RUNTIME_CONFIG.autoLockMinutes * 60_000;
  return {
    mnemonic,
    cardanoAddress: normalized.cardano.paymentAddress,
    cardanoChangeAddress: normalized.cardano.changeAddress,
    cardanoRewardAddress: normalized.cardano.rewardAddress,
    cardanoNetwork: normalized.cardano.network,
    cardanoAccountIndex: normalized.cardano.accountIndex,
    cardanoExternalIndex: normalized.cardano.externalIndex,
    cardanoStakeIndex: normalized.cardano.stakeIndex,
    cardanoPaymentKeyHashHex: normalized.cardano.paymentKeyHashHex,
    cardanoStakeKeyHashHex: normalized.cardano.stakeKeyHashHex,
    midnightAddress: normalized.midnightAddressHint,
    unlockedAt: Date.now(),
    autoLockAt,
  };
};

export const readVaultHints = async (): Promise<{ cardanoAddress: string; midnightAddress: string } | null> => {
  const record = await getVaultRecord();
  if (!record) return null;
  if (record.version === 1) {
    return {
      cardanoAddress: record.cardanoAddressHint,
      midnightAddress: record.midnightAddressHint,
    };
  }
  return {
    cardanoAddress: record.cardano.paymentAddress,
    midnightAddress: record.midnightAddressHint,
  };
};
