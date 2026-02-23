import { RUNTIME_CONFIG } from '@ext/shared/config';
import { fetchBalanceSnapshot } from '@ext/shared/services/backend';
import { grantApproval, getApprovals } from '@ext/shared/storage/preferences';
import { createVault, readVaultHints, unlockVault, vaultExists, type VaultSession } from '@ext/shared/storage/vault';
import type { RuntimeMessage, RuntimeResponse, VaultStatus, WalletBalanceSnapshot } from '@ext/shared/types/runtime';

const networkIdMap: Record<string, number> = {
  mainnet: 1,
  preprod: 0,
  preview: 0,
  standalone: 0,
};

let session: VaultSession | null = null;
let lastBalance: WalletBalanceSnapshot | null = null;

const createRequestId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const makeOk = <T>(requestId: string, data: T): RuntimeResponse<T> => ({ ok: true, data, requestId });

const makeErr = (requestId: string, code: string, message: string): RuntimeResponse<never> => ({
  ok: false,
  error: { code, message },
  requestId,
});

const ensureSessionFresh = () => {
  if (!session) return;
  if (Date.now() >= session.autoLockAt) {
    session = null;
  }
};

const requireSession = (): VaultSession => {
  ensureSessionFresh();
  if (!session) throw new Error('Wallet is locked');
  return session;
};

const derivePseudoSignature = async (message: string): Promise<{ signature: string; key: string }> => {
  const activeSession = requireSession();
  const signatureBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${activeSession.mnemonic}|${message}`),
  );
  const keyBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`darkwallet-key|${activeSession.mnemonic}`),
  );
  const toHex = (bytes: ArrayBuffer) =>
    Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    signature: toHex(signatureBytes),
    key: toHex(keyBytes),
  };
};

const vaultStatus = async (): Promise<VaultStatus> => {
  ensureSessionFresh();
  const exists = await vaultExists();
  const hints = await readVaultHints();
  return {
    exists,
    unlocked: Boolean(session),
    autoLockAt: session?.autoLockAt ?? null,
    publicAddress: hints?.cardanoAddress ?? null,
  };
};

const handleCip30Request = async (
  origin: string,
  method: string,
  params: unknown[] | undefined,
): Promise<unknown> => {
  const approvals = await getApprovals();
  const trustedInternalOrigin = origin.startsWith('chrome-extension://');

  if (method === 'enable') {
    if (!trustedInternalOrigin && !approvals[origin]) {
      throw new Error('Origin is not approved. Open DarkWallet popup and grant access first.');
    }
    return { enabled: true, origin };
  }

  if (!trustedInternalOrigin && !approvals[origin]) {
    throw new Error('Origin is not approved for DarkWallet access');
  }

  if (method === 'getNetworkId') return networkIdMap[RUNTIME_CONFIG.network] ?? 0;
  if (method === 'getUsedAddresses') return [requireSession().cardanoAddress];
  if (method === 'getUnusedAddresses') return [requireSession().cardanoAddress];
  if (method === 'getChangeAddress') return requireSession().cardanoAddress;
  if (method === 'getRewardAddresses') return [];
  if (method === 'getUtxos') return [];

  if (method === 'getBalance') {
    lastBalance = await fetchBalanceSnapshot();
    return lastBalance.adaLovelace;
  }

  if (method === 'signData') {
    const payload = String(params?.[1] ?? '');
    return await derivePseudoSignature(payload);
  }

  if (method === 'signTx') {
    throw new Error('signTx is scheduled for the next milestone (transaction builder integration)');
  }

  if (method === 'submitTx') {
    throw new Error('submitTx is scheduled for the next milestone (node relay integration)');
  }

  throw new Error(`Unsupported CIP-30 method: ${method}`);
};

const handleMessage = async (message: RuntimeMessage): Promise<RuntimeResponse> => {
  const requestId = createRequestId();
  try {
    if (message.kind === 'VAULT_CREATE') {
      const { mnemonic, record } = await createVault(message.password, message.mnemonic);
      session = await unlockVault(message.password);
      return makeOk(requestId, {
        createdAt: record.createdAt,
        cardanoAddress: record.cardanoAddressHint,
        midnightAddress: record.midnightAddressHint,
        mnemonic,
      });
    }

    if (message.kind === 'VAULT_UNLOCK') {
      session = await unlockVault(message.password);
      return makeOk(requestId, {
        unlocked: true,
        cardanoAddress: session.cardanoAddress,
        midnightAddress: session.midnightAddress,
        autoLockAt: session.autoLockAt,
      });
    }

    if (message.kind === 'VAULT_LOCK') {
      session = null;
      return makeOk(requestId, { unlocked: false });
    }

    if (message.kind === 'VAULT_STATUS') {
      return makeOk(requestId, await vaultStatus());
    }

    if (message.kind === 'BALANCE_FETCH') {
      lastBalance = await fetchBalanceSnapshot();
      return makeOk(requestId, lastBalance);
    }

    if (message.kind === 'APPROVAL_LIST') {
      return makeOk(requestId, await getApprovals());
    }

    if (message.kind === 'APPROVAL_GRANT') {
      await grantApproval(message.origin);
      return makeOk(requestId, { origin: message.origin, granted: true });
    }

    if (message.kind === 'CIP30_REQUEST') {
      const data = await handleCip30Request(message.origin, message.method, message.params);
      return makeOk(requestId, data);
    }

    return makeErr(requestId, 'UNSUPPORTED_MESSAGE', `Unsupported message kind: ${(message as RuntimeMessage).kind}`);
  } catch (error) {
    return makeErr(
      requestId,
      'RUNTIME_ERROR',
      error instanceof Error ? error.message : 'Unknown runtime error',
    );
  }
};

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse);
  return true;
});
