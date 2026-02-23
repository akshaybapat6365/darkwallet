import { Panel } from '@ext/components/Panel';
import { useVault } from '@ext/shared/hooks/useVault';

export const WalletPage = () => {
  const { status, balance, loading, error, refresh } = useVault();

  return (
    <>
      <Panel>
        <h2 className="dw-heading">Wallet Identity</h2>
        <p className="dw-sub">Local vault state and chain posture.</p>

        {loading ? <span className="dw-badge warn">Loading...</span> : null}
        {error ? <div className="dw-error">{error}</div> : null}

        <div className="dw-grid" style={{ marginTop: 12 }}>
          <div className="dw-kv">
            <div className="dw-kv-label">Vault</div>
            <div className="dw-kv-value">{status?.exists ? (status.unlocked ? 'Unlocked' : 'Locked') : 'Not initialized'}</div>
          </div>
          <div className="dw-kv">
            <div className="dw-kv-label">Address</div>
            <div className="dw-kv-value dw-code">{status?.publicAddress ?? '—'}</div>
          </div>
          <div className="dw-kv">
            <div className="dw-kv-label">ADA</div>
            <div className="dw-kv-value">{balance?.adaLovelace ?? '0'} lovelace</div>
          </div>
          <div className="dw-kv">
            <div className="dw-kv-label">Midnight</div>
            <div className="dw-kv-value">{balance?.midnightShielded ?? '0'} NIGHT</div>
          </div>
        </div>

        <div className="dw-inline" style={{ marginTop: 12 }}>
          <button className="dw-button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </Panel>
    </>
  );
};
