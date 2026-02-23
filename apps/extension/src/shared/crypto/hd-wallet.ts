const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const digestHex = async (text: string): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(hash));
};

export const deriveCardanoAddressHint = async (mnemonic: string): Promise<string> => {
  const digest = await digestHex(`cardano-cip1852:${mnemonic.trim()}`);
  return `addr_test1dw${digest.slice(0, 48)}`;
};

export const deriveMidnightAddressHint = async (mnemonic: string): Promise<string> => {
  const digest = await digestHex(`midnight-shielded:${mnemonic.trim()}`);
  return `midnight1${digest.slice(0, 56)}`;
};
