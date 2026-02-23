export type Cip30Api = {
  getNetworkId: () => Promise<number>;
  getUsedAddresses: () => Promise<string[]>;
  getUnusedAddresses: () => Promise<string[]>;
  getChangeAddress: () => Promise<string>;
  getRewardAddresses: () => Promise<string[]>;
  getBalance: () => Promise<string>;
  getUtxos: () => Promise<string[]>;
  signData: (address: string, payload: string) => Promise<{ signature: string; key: string }>;
  signTx: (_tx: string, _partialSign?: boolean) => Promise<string>;
  submitTx: (_tx: string) => Promise<string>;
};

export type Cip30Wallet = {
  enable: () => Promise<Cip30Api>;
  isEnabled: () => Promise<boolean>;
  name: string;
  icon?: string;
  apiVersion: string;
};
