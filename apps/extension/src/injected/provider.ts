import type { Cip30Api, Cip30Wallet } from '@ext/shared/types/cip30';

type BridgeRequest = {
  type: 'DW_EXT_REQUEST';
  id: string;
  method: string;
  params?: unknown[];
};

type BridgeResponse = {
  type: 'DW_EXT_RESPONSE';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

const channelRequest = <T>(method: string, params: unknown[] = []): Promise<T> =>
  new Promise((resolve, reject) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const onMessage = (event: MessageEvent<BridgeResponse>) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.type !== 'DW_EXT_RESPONSE' || data.id !== id) return;
      window.removeEventListener('message', onMessage as EventListener);
      if (!data.ok) {
        reject(new Error(data.error ?? 'DarkWallet provider error'));
        return;
      }
      resolve(data.result as T);
    };

    window.addEventListener('message', onMessage as EventListener);
    const request: BridgeRequest = {
      type: 'DW_EXT_REQUEST',
      id,
      method,
      params,
    };
    window.postMessage(request, '*');
  });

const api: Cip30Api = {
  getNetworkId: async () => await channelRequest<number>('getNetworkId'),
  getUsedAddresses: async () => await channelRequest<string[]>('getUsedAddresses'),
  getUnusedAddresses: async () => await channelRequest<string[]>('getUnusedAddresses'),
  getChangeAddress: async () => await channelRequest<string>('getChangeAddress'),
  getRewardAddresses: async () => await channelRequest<string[]>('getRewardAddresses'),
  getBalance: async () => await channelRequest<string>('getBalance'),
  getUtxos: async () => await channelRequest<string[]>('getUtxos'),
  signData: async (address: string, payload: string) =>
    await channelRequest<{ signature: string; key: string }>('signData', [address, payload]),
  signTx: async (tx: string, partialSign?: boolean) =>
    await channelRequest<string>('signTx', [tx, partialSign ?? false]),
  submitTx: async (tx: string) => await channelRequest<string>('submitTx', [tx]),
};

const wallet: Cip30Wallet = {
  name: 'DarkWallet',
  apiVersion: '1.0.0',
  icon: '',
  isEnabled: async () => {
    try {
      await channelRequest<{ enabled: boolean }>('enable');
      return true;
    } catch {
      return false;
    }
  },
  enable: async () => {
    await channelRequest<{ enabled: boolean }>('enable');
    return api;
  },
};

declare global {
  interface Window {
    cardano?: Record<string, unknown>;
  }
}

window.cardano = window.cardano ?? {};
window.cardano.darkwallet = wallet;
