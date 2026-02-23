export const EXTENSION_STORAGE_KEYS = {
  vault: 'darkwallet.vault.v1',
  approvals: 'darkwallet.approvals.v1',
} as const;

export const RUNTIME_CONFIG = {
  backendBaseUrl: import.meta.env.VITE_EXTENSION_BACKEND_BASE_URL ?? 'http://127.0.0.1:4000',
  network: (import.meta.env.VITE_EXTENSION_NETWORK ?? 'standalone') as
    | 'standalone'
    | 'preview'
    | 'preprod'
    | 'mainnet',
  autoLockMinutes: Number(import.meta.env.VITE_EXTENSION_AUTO_LOCK_MINUTES ?? '10'),
};
