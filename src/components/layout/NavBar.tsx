import { Activity, History, Home, ShieldCheck, Wallet, Wrench } from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { truncate } from '../../lib/utils';
import { useWallet } from '../../providers/WalletProvider';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../Button';

const navItems = [
  { to: '/', label: 'Dashboard', icon: Home },
  { to: '/attestation', label: 'Attestation', icon: ShieldCheck },
  { to: '/prescriptions', label: 'Prescriptions', icon: Activity },
  { to: '/history', label: 'History', icon: History },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/dev', label: 'Dev', icon: Wrench },
];

export const NavBar = () => {
  const { connect, disconnect, refresh, availableWallets } = useWallet();
  const wallet = useAppStore((s) => s.wallet);

  return (
    <header className="glass sticky top-0 z-50 border-b border-border/60">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">DarkWallet</div>
            <div className="text-lg font-semibold leading-tight">Privacy-Preserving Prescription Verification</div>
          </div>
        </div>

        <nav className="flex flex-wrap gap-2" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ${isActive ? 'bg-primary text-primary-foreground' : 'bg-background/50 text-foreground hover:bg-accent/20'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-background/60 p-2 text-xs">
          <span className="text-muted-foreground">
            {wallet.address ? `Addr ${truncate(wallet.address, 20)}` : wallet.status}
          </span>
          {wallet.status === 'connected' ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => void refresh()}>
                Refresh
              </Button>
              <Button size="sm" variant="outline" onClick={disconnect}>
                Disconnect
              </Button>
            </>
          ) : availableWallets.length > 0 ? (
            availableWallets.slice(0, 2).map((option) => (
              <Button key={option.id} size="sm" onClick={() => void connect(option.id)}>
                Connect {option.label}
              </Button>
            ))
          ) : (
            <span className="text-muted-foreground">No CIP-30 wallet found</span>
          )}
        </div>
      </div>
    </header>
  );
};
