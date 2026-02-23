import { Wallet, Shield, Signal, Link2 } from 'lucide-react';

import type { HealthResponse } from '../lib/api';
import { truncate } from '../lib/utils';
import { useAppStore } from '../store/useAppStore';
import { Button } from './Button';
import { useWallet } from '../providers/WalletProvider';

type AppHeaderProps = {
  health: HealthResponse | null;
};

export const AppHeader = ({ health }: AppHeaderProps) => {
  const { connect, disconnect, refresh, availableWallets } = useWallet();
  const wallet = useAppStore((s) => s.wallet);

  const contract = health?.contractAddress;
  const network = health?.network;

  return (
    <header className="border-b border-border/60 bg-card/70 backdrop-blur-xl">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-5 md:grid-cols-[1fr_auto_auto] md:items-center">
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Midlight Protocol</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Shielded Prescription Pickup</h1>
          <div className="mt-1 text-sm text-muted-foreground">
            Commitment ledger on Midnight with nullifier-protected redemption
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Signal className="h-4 w-4" />
            Network
          </div>
          <div className="font-medium">{network || 'unknown'}</div>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Link2 className="h-4 w-4" />
            Contract
          </div>
          <div className="font-mono text-xs" title={contract || ''}>
            {contract ? truncate(contract, 24) : 'not deployed'}
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Wallet className="h-4 w-4" />
            CIP-30 Wallet
          </div>
          <div className="mt-1 font-medium capitalize">{wallet.status}</div>
          <div className="text-xs text-muted-foreground">
            {wallet.balance ? `Balance: ${wallet.balance}` : wallet.error ? wallet.error : 'Not connected'}
          </div>
          {wallet.address ? (
            <div className="text-xs text-muted-foreground">
              Address: <span className="font-mono">{truncate(wallet.address, 22)}</span>
            </div>
          ) : null}
          <div className="mt-3 flex gap-2">
            {wallet.status === 'connected' ? (
              <>
                <Button size="sm" variant="secondary" onClick={refresh}>
                  Refresh
                </Button>
                <Button size="sm" variant="outline" onClick={disconnect}>
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                {availableWallets.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No wallet extension detected</div>
                ) : (
                  availableWallets.slice(0, 3).map((walletOption) => (
                    <Button key={walletOption.id} size="sm" onClick={() => void connect(walletOption.id)}>
                      <Shield className="mr-2 h-4 w-4" />
                      Connect {walletOption.label}
                    </Button>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
