export type RuntimeMessageKind =
  | 'VAULT_CREATE'
  | 'VAULT_UNLOCK'
  | 'VAULT_LOCK'
  | 'VAULT_STATUS'
  | 'BALANCE_FETCH'
  | 'APPROVAL_LIST'
  | 'APPROVAL_GRANT'
  | 'CIP30_REQUEST';

export type RuntimeMessage =
  | { kind: 'VAULT_CREATE'; password: string; mnemonic?: string }
  | { kind: 'VAULT_UNLOCK'; password: string }
  | { kind: 'VAULT_LOCK' }
  | { kind: 'VAULT_STATUS' }
  | { kind: 'BALANCE_FETCH' }
  | { kind: 'APPROVAL_LIST' }
  | { kind: 'APPROVAL_GRANT'; origin: string }
  | {
      kind: 'CIP30_REQUEST';
      origin: string;
      method: string;
      params?: unknown[];
    };

export type RuntimeError = {
  code: string;
  message: string;
};

export type RuntimeResponse<T = unknown> =
  | {
      ok: true;
      data: T;
      requestId: string;
    }
  | {
      ok: false;
      error: RuntimeError;
      requestId: string;
    };

export type VaultStatus = {
  exists: boolean;
  unlocked: boolean;
  autoLockAt: number | null;
  publicAddress: string | null;
};

export type WalletBalanceSnapshot = {
  network: 'standalone' | 'preview' | 'preprod' | 'mainnet';
  adaLovelace: string;
  midnightShielded: string;
  fetchedAt: string;
};
