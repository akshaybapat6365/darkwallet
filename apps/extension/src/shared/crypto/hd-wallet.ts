import * as CSL from '@emurgo/cardano-serialization-lib-asmjs';

import { mnemonicEntropyBytes } from './mnemonic';

export type CardanoNetwork = 'standalone' | 'preview' | 'preprod' | 'mainnet';

export type DerivationPathInfo = {
  accountIndex: number;
  externalIndex: number;
  changeIndex: number;
  stakeIndex: number;
};

export type DerivedCardanoWallet = {
  network: CardanoNetwork;
  networkId: number;
  paths: DerivationPathInfo;
  paymentAddress: string;
  changeAddress: string;
  rewardAddress: string;
  paymentPublicKeyHex: string;
  stakePublicKeyHex: string;
  paymentPrivateKeyHex: string;
  stakePrivateKeyHex: string;
  paymentKeyHashHex: string;
  stakeKeyHashHex: string;
};

const HARDENED_INDEX_OFFSET = 0x8000_0000;
const PURPOSE_CIP1852 = HARDENED_INDEX_OFFSET + 1852;
const COIN_TYPE_CARDANO = HARDENED_INDEX_OFFSET + 1815;
const ROLE_EXTERNAL = 0;
const ROLE_CHANGE = 1;
const ROLE_STAKE = 2;

const textEncoder = new TextEncoder();

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const toHardenedIndex = (index: number): number => {
  if (!Number.isInteger(index) || index < 0 || index > 2_147_483_647) {
    throw new Error(`Invalid derivation index: ${index}`);
  }
  return HARDENED_INDEX_OFFSET + index;
};

const resolveNetworkId = (network: CardanoNetwork): number => (network === 'mainnet' ? 1 : 0);

const digestHex = async (text: string): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(text));
  return toHex(new Uint8Array(hash));
};

const deriveAccountRoot = (mnemonic: string, accountIndex: number): CSL.Bip32PrivateKey => {
  const entropy = mnemonicEntropyBytes(mnemonic.trim());
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(entropy, new Uint8Array());
  return root
    .derive(PURPOSE_CIP1852)
    .derive(COIN_TYPE_CARDANO)
    .derive(toHardenedIndex(accountIndex));
};

const deriveRawPrivateKey = (accountRoot: CSL.Bip32PrivateKey, role: number, index: number): CSL.PrivateKey =>
  accountRoot.derive(role).derive(index).to_raw_key();

export const deriveCardanoWallet = async (params: {
  mnemonic: string;
  network: CardanoNetwork;
  accountIndex?: number;
  externalIndex?: number;
  changeIndex?: number;
  stakeIndex?: number;
}): Promise<DerivedCardanoWallet> => {
  const accountIndex = params.accountIndex ?? 0;
  const externalIndex = params.externalIndex ?? 0;
  const changeIndex = params.changeIndex ?? 0;
  const stakeIndex = params.stakeIndex ?? 0;

  const accountRoot = deriveAccountRoot(params.mnemonic, accountIndex);
  const paymentPrivateKey = deriveRawPrivateKey(accountRoot, ROLE_EXTERNAL, externalIndex);
  const changePrivateKey = deriveRawPrivateKey(accountRoot, ROLE_CHANGE, changeIndex);
  const stakePrivateKey = deriveRawPrivateKey(accountRoot, ROLE_STAKE, stakeIndex);

  const paymentPublicKey = paymentPrivateKey.to_public();
  const changePublicKey = changePrivateKey.to_public();
  const stakePublicKey = stakePrivateKey.to_public();

  const paymentKeyHash = paymentPublicKey.hash();
  const changeKeyHash = changePublicKey.hash();
  const stakeKeyHash = stakePublicKey.hash();

  const paymentCredential = CSL.Credential.from_keyhash(paymentKeyHash);
  const changeCredential = CSL.Credential.from_keyhash(changeKeyHash);
  const stakeCredential = CSL.Credential.from_keyhash(stakeKeyHash);
  const networkId = resolveNetworkId(params.network);

  const paymentAddress = CSL.BaseAddress.new(networkId, paymentCredential, stakeCredential)
    .to_address()
    .to_bech32();
  const changeAddress = CSL.BaseAddress.new(networkId, changeCredential, stakeCredential)
    .to_address()
    .to_bech32();
  const rewardAddress = CSL.RewardAddress.new(networkId, stakeCredential)
    .to_address()
    .to_bech32();

  return {
    network: params.network,
    networkId,
    paths: {
      accountIndex,
      externalIndex,
      changeIndex,
      stakeIndex,
    },
    paymentAddress,
    changeAddress,
    rewardAddress,
    paymentPublicKeyHex: toHex(paymentPublicKey.as_bytes()),
    stakePublicKeyHex: toHex(stakePublicKey.as_bytes()),
    paymentPrivateKeyHex: toHex(paymentPrivateKey.as_bytes()),
    stakePrivateKeyHex: toHex(stakePrivateKey.as_bytes()),
    paymentKeyHashHex: toHex(paymentKeyHash.to_bytes()),
    stakeKeyHashHex: toHex(stakeKeyHash.to_bytes()),
  };
};

export const deriveCardanoAddressHint = async (mnemonic: string, network: CardanoNetwork): Promise<string> => {
  const derived = await deriveCardanoWallet({ mnemonic, network });
  return derived.paymentAddress;
};

export const deriveMidnightAddressHint = async (mnemonic: string): Promise<string> => {
  const digest = await digestHex(`midnight-shielded:${mnemonic.trim()}`);
  return `midnight1${digest.slice(0, 56)}`;
};
