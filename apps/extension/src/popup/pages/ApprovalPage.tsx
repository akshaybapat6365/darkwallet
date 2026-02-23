import { useEffect, useState } from 'react';

import { Panel } from '@ext/components/Panel';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';

type Approvals = Record<string, { grantedAt: string }>;

export const ApprovalPage = () => {
  const [origin, setOrigin] = useState('');
  const [approvals, setApprovals] = useState<Approvals>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setError(null);
      const next = await sendRuntimeMessage<Approvals>({ kind: 'APPROVAL_LIST' });
      setApprovals(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approvals');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onGrant = async () => {
    try {
      if (!origin.trim()) return;
      await sendRuntimeMessage({ kind: 'APPROVAL_GRANT', origin: origin.trim() });
      setOrigin('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval grant failed');
    }
  };

  return (
    <Panel>
      <h2 className="dw-heading">DApp Approvals</h2>
      <p className="dw-sub">Manage origin permissions for CIP-30 access.</p>
      {error ? <div className="dw-error">{error}</div> : null}

      <div className="dw-field" style={{ marginTop: 12 }}>
        <span className="dw-label">Grant origin</span>
        <input
          className="dw-input"
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
          placeholder="https://example-dapp.com"
        />
      </div>

      <div className="dw-inline" style={{ marginTop: 10 }}>
        <button className="dw-button" onClick={() => void onGrant()}>
          Grant Access
        </button>
        <button className="dw-button secondary" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <div className="dw-grid" style={{ marginTop: 12 }}>
        {Object.entries(approvals).length ? (
          Object.entries(approvals).map(([approvedOrigin, details]) => (
            <div key={approvedOrigin} className="dw-panel">
              <div className="dw-kv">
                <div className="dw-kv-label">Origin</div>
                <div className="dw-kv-value dw-code">{approvedOrigin}</div>
                <div className="dw-kv-label">Granted</div>
                <div className="dw-kv-value">{new Date(details.grantedAt).toLocaleString()}</div>
              </div>
            </div>
          ))
        ) : (
          <div className="dw-badge warn">No approved origins yet.</div>
        )}
      </div>
    </Panel>
  );
};
