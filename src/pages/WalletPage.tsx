import { Copy } from 'lucide-react';

import { Button } from '../components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { truncate } from '../lib/utils';
import { useWallet } from '../providers/WalletProvider';
import { useAppStore } from '../store/useAppStore';

export const WalletPage = () => {
  const { connect, disconnect, refresh, availableWallets } = useWallet();
  const wallet = useAppStore((s) => s.wallet);

  const copyAddress = async () => {
    if (!wallet.address) return;
    await navigator.clipboard.writeText(wallet.address);
  };

  return (
    <section className="space-y-4 page-enter">
      <Card className="glass">
        <CardHeader>
          <CardTitle>Wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>Status: {wallet.status}</div>
          <div>Wallet: {wallet.walletName ?? '—'}</div>
          <div>Network ID: {wallet.networkId ?? '—'}</div>
          <div className="break-all font-mono">
            Address: {wallet.address ?? '—'} {wallet.address ? <span className="text-muted-foreground">({truncate(wallet.address, 24)})</span> : null}
          </div>
          <div>Balance: {wallet.balance ?? '—'}</div>
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
