import { generateMnemonic, mnemonicToEntropy, validateMnemonic as validate } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export const generateMnemonic24 = (): string => generateMnemonic(wordlist, 256);

export const validateMnemonic = (mnemonic: string): boolean => validate(mnemonic.trim(), wordlist);

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export const mnemonicEntropyBytes = (mnemonic: string): Uint8Array =>
  mnemonicToEntropy(mnemonic.trim(), wordlist);

export const mnemonicEntropyHex = (mnemonic: string): string =>
  bytesToHex(mnemonicEntropyBytes(mnemonic));
