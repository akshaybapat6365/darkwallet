import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/layout/AppShell';
import { AttestationPage } from './pages/AttestationPage';
import { DashboardPage } from './pages/DashboardPage';
import { DevPage } from './pages/DevPage';
import { HistoryPage } from './pages/HistoryPage';
import { PrescriptionPage } from './pages/PrescriptionPage';
import { WalletPage } from './pages/WalletPage';

const App = () => (
  <BrowserRouter>
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/attestation" element={<AttestationPage />} />
        <Route path="/prescriptions" element={<PrescriptionPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/dev" element={<DevPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  </BrowserRouter>
);

export default App;
