import { extensionFetch } from './http';
import type { WalletBalanceSnapshot } from '../types/runtime';

export const fetchBackendHealth = async (): Promise<unknown> => {
  return await extensionFetch('/api/health');
};

export const fetchBalanceSnapshot = async (): Promise<WalletBalanceSnapshot> => {
  // Extension v1 foundation: source balances from backend while local key custody is integrated.
  const health = (await fetchBackendHealth()) as { network?: string };
  return {
    network: (health.network as WalletBalanceSnapshot['network']) ?? 'standalone',
    adaLovelace: '0',
    midnightShielded: '0',
    fetchedAt: new Date().toISOString(),
  };
};

export const submitCardanoTransaction = async (txCborHex: string): Promise<{ txHash: string }> =>
  await extensionFetch('/api/v1/cardano/submit-tx', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ txCborHex }),
  });
