import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';

import { AttestationPage } from './pages/AttestationPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { PrescriptionPage } from './pages/PrescriptionPage';
import { WalletPage } from './pages/WalletPage';

const App = () => (
  <BrowserRouter>
    <div className="dw-app">
      <header className="dw-header">
        <div className="dw-brand-kicker">DarkWallet Fullpage</div>
        <div className="dw-brand-title">Command Center</div>
        <div className="dw-brand-sub">Privacy timelines, attestation, and prescription workflows.</div>
      </header>

      <nav className="dw-nav" aria-label="Primary">
        {[
          { to: '/', label: 'Dashboard' },
          { to: '/attestation', label: 'Attestation' },
          { to: '/prescriptions', label: 'Prescriptions' },
          { to: '/history', label: 'History' },
          { to: '/wallet', label: 'Wallet' },
        ].map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="dw-main dw-main-full">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/attestation" element={<AttestationPage />} />
          <Route path="/prescriptions" element={<PrescriptionPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="dw-footer">
        Fullpage surfaces migrated for extension-first operation. Backend: configurable via VITE_EXTENSION_BACKEND_BASE_URL.
      </footer>
    </div>
  </BrowserRouter>
);

export default App;
