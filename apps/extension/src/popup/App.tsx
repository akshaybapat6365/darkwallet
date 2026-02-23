import type { ReactNode } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { ApprovalPage } from './pages/ApprovalPage';
import { BalancePage } from './pages/BalancePage';
import { ReceivePage } from './pages/ReceivePage';
import { SendPage } from './pages/SendPage';
import { UnlockPage } from './pages/UnlockPage';

const PopupShell = ({ children }: { children: ReactNode }) => (
  <div className="dw-app" style={{ width: 400, minHeight: 600 }}>
    <header className="dw-header">
      <div className="dw-brand-kicker">DarkWallet Extension</div>
      <div className="dw-brand-title">Private Wallet</div>
      <div className="dw-brand-sub">Cardano L1 + Midnight L2</div>
    </header>

    <nav className="dw-nav" aria-label="Popup">
      {[
        { to: '/unlock', label: 'Unlock' },
        { to: '/balance', label: 'Balance' },
        { to: '/send', label: 'Send' },
        { to: '/receive', label: 'Receive' },
        { to: '/approvals', label: 'Approvals' },
      ].map((item) => (
        <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
          {item.label}
        </NavLink>
      ))}
    </nav>

    <main className="dw-main">{children}</main>
    <footer className="dw-footer">DarkWallet extension v0.2.0 • luxury minimal profile</footer>
  </div>
);

const App = () => (
  <HashRouter>
    <PopupShell>
      <Routes>
        <Route path="/unlock" element={<UnlockPage />} />
        <Route path="/balance" element={<BalancePage />} />
        <Route path="/send" element={<SendPage />} />
        <Route path="/receive" element={<ReceivePage />} />
        <Route path="/approvals" element={<ApprovalPage />} />
        <Route path="*" element={<Navigate to="/unlock" replace />} />
      </Routes>
    </PopupShell>
  </HashRouter>
);

export default App;
