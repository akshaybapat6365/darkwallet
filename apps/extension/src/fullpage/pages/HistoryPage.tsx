import { useEffect, useState } from 'react';

import { Panel } from '@ext/components/Panel';
import { extensionFetch } from '@ext/shared/services/http';

type PickupRecord = {
  commitmentHex: string;
  rxId: string;
  pharmacyIdHex: string;
  registeredBlockHeight: number;
  redeemedBlockHeight: number | null;
  revokedAt: string | null;
};

export const HistoryPage = () => {
  const [records, setRecords] = useState<PickupRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setError(null);
        const response = await extensionFetch<{ pickups: PickupRecord[] }>('/api/v1/pickups?limit=40&offset=0');
        setRecords(response.pickups);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load history');
      }
    };
    void load();
  }, []);

  return (
    <Panel>
      <h2 className="dw-heading">Pickup History</h2>
      <p className="dw-sub">Indexed commitments, revocations, and redemptions.</p>
      {error ? <div className="dw-error">{error}</div> : null}
      <div className="dw-grid" style={{ marginTop: 12 }}>
        {records.length ? (
          records.map((entry) => (
            <div key={entry.commitmentHex} className="dw-panel">
              <div className="dw-kv">
                <div className="dw-kv-label">Commitment</div>
                <div className="dw-kv-value dw-code">{entry.commitmentHex}</div>
                <div className="dw-kv-label">Rx / Pharmacy</div>
                <div className="dw-kv-value">{entry.rxId} / {entry.pharmacyIdHex.slice(0, 12)}...</div>
                <div className="dw-kv-label">Status</div>
                <div className="dw-kv-value">
                  {entry.revokedAt ? 'Revoked' : entry.redeemedBlockHeight ? 'Redeemed' : 'Active'}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="dw-badge warn">No history records.</div>
        )}
      </div>
    </Panel>
  );
};
