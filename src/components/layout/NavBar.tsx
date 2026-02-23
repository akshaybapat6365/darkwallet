import React from 'react';
import {
  Activity,
  History,
  Home,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';

import { truncate } from '../../lib/utils';
import { useTheme } from '../../providers/ThemeProvider';
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

const navLinkClass = (isActive: boolean) =>
  `inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'bg-background/50 text-foreground hover:bg-accent/20'
  }`;

export const NavBar = () => {
  const location = useLocation();
  const { connect, disconnect, refresh, availableWallets } = useWallet();
  const wallet = useAppStore((s) => s.wallet);
  const { resolvedTheme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const walletLabel = wallet.address ? `Addr ${truncate(wallet.address, 20)}` : wallet.status;

  return (
    <header className="glass sticky top-0 z-50 border-b border-border/60">
      <div className="mx-auto w-full max-w-7xl px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">DarkWallet</div>
            <div className="text-base font-semibold leading-tight md:text-lg">Privacy-Preserving Prescription Verification</div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Toggle theme"
              onClick={toggleTheme}
            >
              {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="mobile-only-inline-flex"
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              onClick={() => setMobileOpen((prev) => !prev)}
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="desktop-only mt-3 flex items-center justify-between gap-3">
          <nav className="flex flex-wrap gap-2" aria-label="Primary">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => navLinkClass(isActive)}>
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-background/60 p-2 text-xs">
            <span className="text-muted-foreground">{walletLabel}</span>
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

        <div className="mobile-only-flex mt-3 items-center justify-between gap-2 rounded-md border border-border/70 bg-background/60 p-2 text-xs">
          <span className="truncate text-muted-foreground">{walletLabel}</span>
          <div className="flex items-center gap-2">
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
              availableWallets.slice(0, 1).map((option) => (
                <Button key={option.id} size="sm" onClick={() => void connect(option.id)}>
                  Connect {option.label}
                </Button>
              ))
            ) : (
              <span className="text-muted-foreground">No wallet</span>
            )}
          </div>
        </div>

        {mobileOpen ? (
          <div className="mobile-only mt-3 rounded-lg border border-border/60 bg-background/70 p-3 shadow-xl">
            <nav className="grid grid-cols-2 gap-2" aria-label="Primary">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => navLinkClass(isActive)}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>
            <div className="mt-3 rounded-md border border-border/70 bg-background/70 p-2 text-xs">
              <div className="mb-2 text-muted-foreground">{walletLabel}</div>
              <div className="flex flex-wrap gap-2">
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
          </div>
        ) : null}
      </div>

      <nav
        className="mobile-only fixed bottom-0 left-0 right-0 z-40 border-t border-border/60 bg-background/90 p-2 backdrop-blur"
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-1">
          {navItems.slice(0, 5).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex min-w-0 flex-1 flex-col items-center rounded-md px-2 py-1 text-[11px] ${
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                <span className="mt-1 truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </header>
  );
};
