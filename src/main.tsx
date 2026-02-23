import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import App from './App';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';
import { WalletProvider } from './providers/WalletProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <App />
          <Toaster richColors position="top-right" />
        </WalletProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
