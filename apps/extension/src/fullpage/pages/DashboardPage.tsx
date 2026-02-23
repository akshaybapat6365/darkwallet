import { useEffect, useState } from 'react';

import { MetricCard } from '@ext/components/MetricCard';
import { Panel } from '@ext/components/Panel';
import { extensionFetch } from '@ext/shared/services/http';

type HealthData = {
  ok: boolean;
  network: string;
  contractAddress: string | null;
  patientCount: number;
  probes?: {
    redis: { ok: boolean };
    postgres: { ok: boolean };
    proofServer: { ok: boolean };
  };
};

type PickupRecord = {
  commitmentHex: string;
  rxId: string;
  registeredBlockHeight: number;
  redeemedTxId: string | null;
};

export const DashboardPage = () => {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [pickups, setPickups] = useState<PickupRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setError(null);
        const [h, p] = await Promise.all([
          extensionFetch<HealthData>('/api/health'),
          extensionFetch<{ pickups: PickupRecord[] }>('/api/v1/pickups?limit=5&offset=0'),
        ]);
        setHealth(h);
        setPickups(p.pickups);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      }
    };
    void load();
  }, []);

  return (
    <>
      <Panel>
        <h2 className="dw-heading">Network Snapshot</h2>
        <p className="dw-sub">Operational posture across Cardano + Midnight infrastructure.</p>

        {error ? <div className="dw-error">{error}</div> : null}

        <div className="dw-grid dw-grid-2" style={{ marginTop: 10 }}>
          <MetricCard label="Network" value={health?.network ?? '—'}>
            {health?.ok ? 'healthy' : 'degraded'}
          </MetricCard>
          <MetricCard label="Patients" value={String(health?.patientCount ?? 0)}>
            contract aware
          </MetricCard>
        </div>

        <div className="dw-panel" style={{ marginTop: 12 }}>
          <div className="dw-kv">
            <div className="dw-kv-label">Contract</div>
            <div className="dw-kv-value dw-code">{health?.contractAddress ?? 'Not joined'}</div>
          </div>
        </div>
      </Panel>

      <Panel>
        <h2 className="dw-heading">Recent Pickups</h2>
        <p className="dw-sub">Latest privacy commitments and redemption status.</p>
        <div className="dw-grid">
          {pickups.length ? (
            pickups.map((entry) => (
              <div key={entry.commitmentHex} className="dw-panel">
                <div className="dw-kv">
                  <div className="dw-kv-label">Commitment</div>
                  <div className="dw-kv-value dw-code">{entry.commitmentHex}</div>
                  <div className="dw-kv-label">Rx</div>
                  <div className="dw-kv-value">{entry.rxId}</div>
                  <div className="dw-kv-label">Status</div>
                  <div className="dw-kv-value">{entry.redeemedTxId ? 'Redeemed' : 'Active'}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="dw-badge warn">No pickups indexed.</div>
          )}
        </div>
      </Panel>
    </>
  );
};
