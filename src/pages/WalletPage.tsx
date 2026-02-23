import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';

import { Button } from '../components/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { api } from '../lib/api';
import { truncate } from '../lib/utils';
import { useWallet } from '../providers/WalletProvider';
import { useAppStore } from '../store/useAppStore';

const formatBalance = (raw: string | null): string => {
  if (!raw) return '—';
  try {
    if (!/^[0-9]+$/.test(raw.trim())) return raw;
    const lovelace = BigInt(raw.trim());
    const adaWhole = lovelace / 1_000_000n;
    const adaFrac = String(lovelace % 1_000_000n).padStart(6, '0').replace(/0+$/, '');
    return adaFrac.length > 0 ? `${adaWhole.toString()}.${adaFrac} ADA` : `${adaWhole.toString()} ADA`;
  } catch {
    return raw;
  }
};

const WalletSkeleton = () => (
  <section className="space-y-4 page-enter" aria-busy="true" aria-live="polite">
    <Card className="glass">
      <CardHeader>
        <Skeleton className="h-7 w-28" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-60" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-10 w-36" />
      </CardContent>
    </Card>
  </section>
);

export const WalletPage = () => {
  const { connect, disconnect, refresh, availableWallets } = useWallet();
  const wallet = useAppStore((s) => s.wallet);
  const health = useQuery({
    queryKey: ['health-wallet'],
    queryFn: api.health,
    refetchInterval: 8_000,
  });

  const copyAddress = async () => {
    if (!wallet.address) return;
    await navigator.clipboard.writeText(wallet.address);
  };

  if (health.isLoading && wallet.status === 'disconnected') {
    return <WalletSkeleton />;
  }

  return (
    <section className="space-y-4 page-enter">
      <Card className="glass">
        <CardHeader>
          <CardTitle>Wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>Status: {wallet.status}</div>
          <div>Wallet: {wallet.walletName ?? '—'}</div>
          <div>Network ID: {wallet.networkId ?? '—'} ({health.data?.network ?? 'unknown'})</div>
          <div className="break-all font-mono">
            Address: {wallet.address ?? '—'}{' '}
            {wallet.address ? <span className="text-muted-foreground">({truncate(wallet.address, 24)})</span> : null}
          </div>
          <div>Balance: {formatBalance(wallet.balance)}</div>
          {wallet.error ? <div className="text-destructive">{wallet.error}</div> : null}

          <div className="flex flex-wrap gap-2">
            {wallet.status === 'connected' ? (
              <>
                <Button variant="secondary" onClick={() => void refresh()}>
                  Refresh Balance
                </Button>
                <Button variant="outline" onClick={disconnect}>
                  Disconnect
                </Button>
                <Button variant="ghost" onClick={() => void copyAddress()}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Address
                </Button>
              </>
            ) : availableWallets.length > 0 ? (
              availableWallets.map((option) => (
                <Button key={option.id} onClick={() => void connect(option.id)}>
                  Connect {option.label}
                </Button>
              ))
            ) : (
              <div className="text-muted-foreground">No supported wallet extension detected.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
};
