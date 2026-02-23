import { RUNTIME_CONFIG } from '../config';
import type { WalletBalanceSnapshot } from '../types/runtime';

export const fetchBackendHealth = async (): Promise<unknown> => {
  const response = await fetch(`${RUNTIME_CONFIG.backendBaseUrl}/api/health`);
  if (!response.ok) throw new Error(`Health request failed: ${response.status}`);
  return await response.json();
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
