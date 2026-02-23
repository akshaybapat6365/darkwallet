import { useMemo, useState } from 'react';

import { Panel } from '@ext/components/Panel';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';
import { useVault } from '@ext/shared/hooks/useVault';

export const UnlockPage = () => {
  const { status, loading, error, refresh } = useVault();
  const [password, setPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const canCreate = useMemo(() => !status?.exists, [status?.exists]);

  const run = async (action: 'create' | 'unlock' | 'lock') => {
    try {
      setBusy(true);
      setLocalError(null);
      setResult(null);

      if (action === 'create') {
        const data = await sendRuntimeMessage<{ mnemonic: string; cardanoAddress: string }>({
          kind: 'VAULT_CREATE',
          password,
          mnemonic: mnemonic.trim() || undefined,
        });
        setMnemonic(data.mnemonic);
        setResult(`Vault created. Address: ${data.cardanoAddress}`);
      }

      if (action === 'unlock') {
        const data = await sendRuntimeMessage<{ cardanoAddress: string }>({ kind: 'VAULT_UNLOCK', password });
        setResult(`Unlocked: ${data.cardanoAddress}`);
      }

      if (action === 'lock') {
        await sendRuntimeMessage({ kind: 'VAULT_LOCK' });
        setResult('Wallet locked');
      }

      await refresh();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Wallet action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <h2 className="dw-heading">Vault Access</h2>
      <p className="dw-sub">Create/import your encrypted vault, then unlock for signing.</p>

      {loading ? <div className="dw-badge warn">Checking vault status...</div> : null}
      {status ? (
        <div className="dw-inline">
          <span className={`dw-badge ${status.unlocked ? 'success' : 'warn'}`}>
            {status.unlocked ? 'Unlocked' : status.exists ? 'Locked' : 'Not initialized'}
          </span>
        </div>
      ) : null}

      {error ? <div className="dw-error" style={{ marginTop: 10 }}>{error}</div> : null}
      {localError ? <div className="dw-error" style={{ marginTop: 10 }}>{localError}</div> : null}
      {result ? <div className="dw-badge success" style={{ marginTop: 10 }}>{result}</div> : null}

      <div className="dw-grid" style={{ marginTop: 12 }}>
        <label className="dw-field">
          <span className="dw-label">Password</span>
          <input
            className="dw-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter wallet password"
          />
        </label>

        {canCreate ? (
          <label className="dw-field">
            <span className="dw-label">Mnemonic (optional import)</span>
            <textarea
              className="dw-textarea"
              value={mnemonic}
              onChange={(event) => setMnemonic(event.target.value)}
              placeholder="Leave empty to generate 24 words"
            />
          </label>
        ) : null}
      </div>

      <div className="dw-inline" style={{ marginTop: 12 }}>
        {canCreate ? (
          <button className="dw-button" disabled={busy || password.length < 8} onClick={() => void run('create')}>
            Create or Import Vault
          </button>
        ) : (
          <button className="dw-button" disabled={busy || password.length < 8} onClick={() => void run('unlock')}>
            Unlock Wallet
          </button>
        )}
        <button className="dw-button secondary" disabled={busy} onClick={() => void run('lock')}>
          Lock
        </button>
      </div>

      {canCreate && mnemonic ? (
        <div className="dw-panel" style={{ marginTop: 12 }}>
          <div className="dw-kv">
            <div className="dw-kv-label">Recovery phrase</div>
            <div className="dw-kv-value dw-code">{mnemonic}</div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
};
