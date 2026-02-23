import React from 'react';
import '@midnight-ntwrk/dapp-connector-api';

import { useAppStore } from '../store/useAppStore';

type Cip30Api = {
  getNetworkId?: () => Promise<number>;
  getBalance?: () => Promise<string>;
  getUsedAddresses?: () => Promise<string[]>;
  getChangeAddress?: () => Promise<string>;
  signData?: (address: string, payloadHex: string) => Promise<{ signature: string; key: string }>;
};

type LaceProvider = {
  enable: () => Promise<Cip30Api>;
  isEnabled?: () => Promise<boolean>;
};

type DiscoveredWallet = {
  id: string;
  label: string;
  provider: LaceProvider;
};

type WalletContextValue = {
  connect: (walletId?: string) => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;
  getSigningAddressHex: () => Promise<string>;
  availableWallets: Array<{ id: string; label: string }>;
  signPayloadHex: (payloadHex: string) => Promise<{
    walletAddress: string;
    signedPayloadHex: string;
    coseSign1Hex: string;
    coseKeyHex: string;
  }>;
  api: Cip30Api | null;
};

const WalletContext = React.createContext<WalletContextValue | null>(null);

declare global {
  interface Window {
    cardano?: {
      [key: string]: unknown;
    };
  }
}

const walletStorageKey = 'midlight.wallet.id';

const formatWalletLabel = (id: string): string => {
  if (id.toLowerCase() === 'nami') return 'Nami';
  if (id.toLowerCase() === 'eternl') return 'Eternl';
  if (id.toLowerCase() === 'vespr') return 'Vespr';
  if (id.toLowerCase() === 'yoroi') return 'Yoroi';
  if (id.toLowerCase() === 'lace') return 'Lace';
  return id.charAt(0).toUpperCase() + id.slice(1);
};

const discoverWallets = (): DiscoveredWallet[] => {
  const discovered: DiscoveredWallet[] = [];
  const cardano = window.cardano ?? {};
  for (const [id, candidate] of Object.entries(cardano)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const provider = candidate as LaceProvider;
    if (typeof provider.enable !== 'function') continue;
    discovered.push({
      id,
      label: formatWalletLabel(id),
      provider,
    });
  }
  discovered.sort((a, b) => a.label.localeCompare(b.label));
  return discovered;
};

export const WalletProvider = ({ children }: { children: React.ReactNode }) => {
  const [api, setApi] = React.useState<Cip30Api | null>(null);
  const [connectedWalletId, setConnectedWalletId] = React.useState<string | null>(null);
  const [availableWallets, setAvailableWallets] = React.useState<DiscoveredWallet[]>([]);
  const setWalletState = useAppStore((s) => s.setWalletState);
  const setWalletError = useAppStore((s) => s.setWalletError);
  const clearWallet = useAppStore((s) => s.clearWallet);

  const refreshAvailableWallets = React.useCallback(() => {
    setAvailableWallets(discoverWallets());
  }, []);

  React.useEffect(() => {
    refreshAvailableWallets();
  }, [refreshAvailableWallets]);

  const getSigningAddressHex = React.useCallback(async (): Promise<string> => {
    if (!api) throw new Error('Wallet not connected');
    if (api.getUsedAddresses) {
      const used = await api.getUsedAddresses();
      if (used.length > 0) return used[0];
    }
    if (api.getChangeAddress) {
      const change = await api.getChangeAddress();
      if (change) return change;
    }
    throw new Error('Could not determine signing address from wallet');
  }, [api]);

  const refresh = React.useCallback(async () => {
    if (!api) return;
    const walletAddress = await getSigningAddressHex();
    const [networkId, balance] = await Promise.all([
      api.getNetworkId ? api.getNetworkId() : Promise.resolve(null),
      api.getBalance ? api.getBalance() : Promise.resolve(null),
    ]);
    setWalletState({
      status: 'connected',
      walletName: connectedWalletId ? formatWalletLabel(connectedWalletId) : 'Wallet',
      address: walletAddress,
      networkId: networkId ?? null,
      balance,
      error: null,
    });
  }, [api, connectedWalletId, getSigningAddressHex, setWalletState]);

  const signPayloadHex = React.useCallback(
    async (payloadHex: string) => {
      if (!api) throw new Error('Wallet not connected');
      if (!api.signData) throw new Error('Wallet does not support CIP-30 signData');
      const walletAddress = await getSigningAddressHex();
      const signature = await api.signData(walletAddress, payloadHex);
      return {
        walletAddress,
        signedPayloadHex: payloadHex.replace(/^0x/i, ''),
        coseSign1Hex: signature.signature,
        coseKeyHex: signature.key,
      };
    },
    [api, getSigningAddressHex],
  );

  const connect = React.useCallback(async (walletId?: string) => {
    try {
      setWalletState({ status: 'connecting', error: null });
      const wallets = discoverWallets();
      setAvailableWallets(wallets);
      const selected = walletId ? wallets.find((wallet) => wallet.id === walletId) : wallets[0];
      if (!selected) throw new Error('No CIP-30 wallet extension detected (install Lace, Nami, Eternl, Vespr, or Yoroi)');
      const enabledApi = await selected.provider.enable();
      setApi(enabledApi);
      setConnectedWalletId(selected.id);
      localStorage.setItem(walletStorageKey, selected.id);
      const walletAddress = await (async () => {
        if (enabledApi.getUsedAddresses) {
          const used = await enabledApi.getUsedAddresses();
          if (used.length > 0) return used[0];
        }
        if (enabledApi.getChangeAddress) return await enabledApi.getChangeAddress();
        return null;
      })();
      const [networkId, balance] = await Promise.all([
        enabledApi.getNetworkId ? enabledApi.getNetworkId() : Promise.resolve(null),
        enabledApi.getBalance ? enabledApi.getBalance() : Promise.resolve(null),
      ]);
      setWalletState({
        status: 'connected',
        walletName: selected.label,
        address: walletAddress,
        networkId: networkId ?? null,
        balance,
        error: null,
      });
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : String(err));
    }
  }, [setWalletError, setWalletState]);

  const disconnect = React.useCallback(() => {
    setApi(null);
    setConnectedWalletId(null);
    localStorage.removeItem(walletStorageKey);
    clearWallet();
  }, [clearWallet]);

  React.useEffect(() => {
    const remembered = localStorage.getItem(walletStorageKey);
    if (!remembered) return;

    const wallets = discoverWallets();
    const selected = wallets.find((wallet) => wallet.id === remembered);
    if (!selected) return;

    if (selected.provider.isEnabled) {
      selected.provider
        .isEnabled()
        .then((isEnabled) => {
          if (!isEnabled) return;
          void connect(selected.id);
        })
        .catch(() => {
          // Ignore auto-reconnect failures.
        });
      return;
    }

    void connect(selected.id).catch(() => {
      // Ignore auto-reconnect failures.
    });
  }, [connect]);

  const value = React.useMemo<WalletContextValue>(
    () => ({
      connect,
      disconnect,
      refresh,
      getSigningAddressHex,
      availableWallets: availableWallets.map((wallet) => ({ id: wallet.id, label: wallet.label })),
      signPayloadHex,
      api,
    }),
    [api, availableWallets, connect, disconnect, refresh, getSigningAddressHex, signPayloadHex],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = (): WalletContextValue => {
  const ctx = React.useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
};
