import { useCallback, useEffect, useState } from 'react';

import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';
import type { VaultStatus, WalletBalanceSnapshot } from '@ext/shared/types/runtime';

export const useVault = () => {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [balance, setBalance] = useState<WalletBalanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const nextStatus = await sendRuntimeMessage<VaultStatus>({ kind: 'VAULT_STATUS' });
      setStatus(nextStatus);
      if (nextStatus.unlocked) {
        const nextBalance = await sendRuntimeMessage<WalletBalanceSnapshot>({ kind: 'BALANCE_FETCH' });
        setBalance(nextBalance);
      } else {
        setBalance(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch wallet status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    status,
    balance,
    loading,
    error,
    refresh,
    setError,
  };
};
