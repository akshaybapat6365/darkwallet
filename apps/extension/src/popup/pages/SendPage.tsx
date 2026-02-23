import { useState } from 'react';

import { Panel } from '@ext/components/Panel';
import { useVault } from '@ext/shared/hooks/useVault';

export const SendPage = () => {
  const { status } = useVault();
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  return (
    <Panel>
      <h2 className="dw-heading">Send</h2>
      <p className="dw-sub">Transaction builder is active for form validation; relay signing is in the next milestone.</p>

      {!status?.unlocked ? <div className="dw-error">Unlock wallet before preparing a transfer.</div> : null}

      <div className="dw-grid" style={{ marginTop: 12 }}>
        <label className="dw-field">
          <span className="dw-label">Destination address</span>
          <input className="dw-input dw-code" value={toAddress} onChange={(event) => setToAddress(event.target.value)} />
        </label>

        <label className="dw-field">
          <span className="dw-label">Amount (ADA)</span>
          <input className="dw-input" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>

        <label className="dw-field">
          <span className="dw-label">Memo</span>
          <textarea className="dw-textarea" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>

      <div className="dw-inline" style={{ marginTop: 12 }}>
        <button className="dw-button" disabled={!status?.unlocked || !toAddress || !amount}>
          Prepare Transfer
        </button>
        <button className="dw-button secondary" disabled>
          Sign & Broadcast (Next)
        </button>
      </div>
    </Panel>
  );
};
