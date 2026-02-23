import { create } from 'zustand';

import type { JobEvent, JobSnapshot } from '../lib/api';

export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type WalletState = {
  status: WalletStatus;
  walletName: string | null;
  address: string | null;
  networkId: number | null;
  balance: string | null;
  error: string | null;
};

type AppState = {
  wallet: WalletState;
  activeJob: JobSnapshot | null;
  activeJobEvent: JobEvent | null;
  setWalletState: (next: Partial<WalletState>) => void;
  setWalletError: (message: string) => void;
  clearWallet: () => void;
  setActiveJob: (job: JobSnapshot | null) => void;
  setActiveJobEvent: (event: JobEvent | null) => void;
};

const initialWallet: WalletState = {
  status: 'disconnected',
  walletName: null,
  address: null,
  networkId: null,
  balance: null,
  error: null,
};

export const useAppStore = create<AppState>((set) => ({
  wallet: initialWallet,
  activeJob: null,
  activeJobEvent: null,
  setWalletState: (next) =>
    set((state) => ({
      wallet: {
        ...state.wallet,
        ...next,
        error: next.error ?? null,
      },
    })),
  setWalletError: (message) =>
    set((state) => ({
      wallet: {
        ...state.wallet,
        status: 'error',
        error: message,
      },
    })),
  clearWallet: () => set({ wallet: initialWallet }),
  setActiveJob: (job) => set({ activeJob: job }),
  setActiveJobEvent: (event) => set({ activeJobEvent: event }),
}));
