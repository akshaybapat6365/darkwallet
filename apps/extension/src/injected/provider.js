const channelRequest = (method, params = []) =>
  new Promise((resolve, reject) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    const onMessage = (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.type !== 'DW_EXT_RESPONSE' || data.id !== id) return;
      window.removeEventListener('message', onMessage);
      if (!data.ok) {
        reject(new Error(data.error ?? 'DarkWallet provider error'));
        return;
      }
      resolve(data.result);
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      {
        type: 'DW_EXT_REQUEST',
        id,
        method,
        params,
      },
      '*',
    );
  });

const api = {
  getNetworkId: async () => await channelRequest('getNetworkId'),
  getUsedAddresses: async () => await channelRequest('getUsedAddresses'),
  getUnusedAddresses: async () => await channelRequest('getUnusedAddresses'),
  getChangeAddress: async () => await channelRequest('getChangeAddress'),
  getRewardAddresses: async () => await channelRequest('getRewardAddresses'),
  getBalance: async () => await channelRequest('getBalance'),
  getUtxos: async () => await channelRequest('getUtxos'),
  signData: async (address, payload) => await channelRequest('signData', [address, payload]),
  signTx: async (tx, partialSign) => await channelRequest('signTx', [tx, partialSign ?? false]),
  submitTx: async (tx) => await channelRequest('submitTx', [tx]),
};

const wallet = {
  name: 'DarkWallet',
  apiVersion: '1.0.0',
  icon: '',
  isEnabled: async () => {
    try {
      await channelRequest('enable');
      return true;
    } catch {
      return false;
    }
  },
  enable: async () => {
    await channelRequest('enable');
    return api;
  },
};

window.cardano = window.cardano ?? {};
window.cardano.darkwallet = wallet;
