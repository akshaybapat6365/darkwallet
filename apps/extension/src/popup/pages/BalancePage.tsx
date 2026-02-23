import { MetricCard } from '@ext/components/MetricCard';
import { Panel } from '@ext/components/Panel';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';
import { useVault } from '@ext/shared/hooks/useVault';

const formatAda = (lovelace: string) => {
  const value = Number(lovelace);
  if (!Number.isFinite(value)) return lovelace;
  return `${(value / 1_000_000).toFixed(6)} ADA`;
};

export const BalancePage = () => {
  const { status, balance, loading, error, refresh } = useVault();

  return (
    <Panel>
      <h2 className="dw-heading">Portfolio</h2>
      <p className="dw-sub">Dual-chain snapshot with privacy-first posture.</p>

      {status?.unlocked ? <span className="dw-badge success">Wallet unlocked</span> : <span className="dw-badge warn">Wallet locked</span>}
      {error ? <div className="dw-error" style={{ marginTop: 10 }}>{error}</div> : null}

      <div className="dw-grid dw-grid-2" style={{ marginTop: 12 }}>
        <MetricCard label="Cardano" value={balance ? formatAda(balance.adaLovelace) : '—'}>
          {balance ? balance.network : 'No network'}
        </MetricCard>
        <MetricCard label="Midnight" value={balance ? `${balance.midnightShielded} NIGHT` : '—'}>
          shielded
        </MetricCard>
      </div>

      <div className="dw-panel" style={{ marginTop: 12 }}>
        <div className="dw-kv">
          <div className="dw-kv-label">Primary Address</div>
          <div className="dw-kv-value dw-code">{status?.publicAddress ?? 'No vault address yet'}</div>
        </div>
      </div>

      <div className="dw-inline" style={{ marginTop: 12 }}>
        <button className="dw-button" disabled={loading} onClick={() => void refresh()}>
          Refresh Snapshot
        </button>
        <button className="dw-button secondary" onClick={() => void sendRuntimeMessage({ kind: 'VAULT_LOCK' }).then(() => refresh())}>
          Lock Wallet
        </button>
      </div>
    </Panel>
  );
};
