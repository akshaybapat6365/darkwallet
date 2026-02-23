import { useState } from 'react';

import { Panel } from '@ext/components/Panel';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';
import { extensionFetch } from '@ext/shared/services/http';
import { useVault } from '@ext/shared/hooks/useVault';

type IntentPrepareResponse = {
  intentId: string;
  payloadHex: string;
};

type IntentSubmitResponse = {
  intentId: string;
  jobId: string;
};

export const PrescriptionPage = () => {
  const { status } = useVault();
  const [mode, setMode] = useState<'registerAuthorization' | 'redeem'>('registerAuthorization');
  const [patientId, setPatientId] = useState('');
  const [rxId, setRxId] = useState('');
  const [pharmacyIdHex, setPharmacyIdHex] = useState('');
  const [attestationHash, setAttestationHash] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    try {
      if (!status?.publicAddress) throw new Error('Unlock vault before submitting intent');
      setError(null);
      setJobId(null);

      const body =
        mode === 'registerAuthorization'
          ? { action: mode, body: { rxId, pharmacyIdHex, patientId, attestationHash } }
          : { action: mode, body: { patientId, rxId, pharmacyIdHex, attestationHash } };

      const prepared = await extensionFetch<IntentPrepareResponse>('/api/v1/intents/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const signature = await sendRuntimeMessage<{ signature: string; key: string }>({
        kind: 'CIP30_REQUEST',
        origin: 'chrome-extension://darkwallet',
        method: 'signData',
        params: [status.publicAddress, prepared.payloadHex],
      });

      const submitted = await extensionFetch<IntentSubmitResponse>('/api/v1/intents/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intentId: prepared.intentId,
          walletAddress: status.publicAddress,
          signedPayloadHex: prepared.payloadHex,
          coseSign1Hex: signature.signature,
          coseKeyHex: signature.key,
        }),
      });

      setJobId(submitted.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Intent submission failed');
    }
  };

  return (
    <Panel>
      <h2 className="dw-heading">Prescription Flow</h2>
      <p className="dw-sub">Prepare signed intents for register/redeem through remote prover queue.</p>

      {!status?.unlocked ? <div className="dw-error">Unlock wallet before signing intent payloads.</div> : null}
      {error ? <div className="dw-error">{error}</div> : null}

      <div className="dw-inline" style={{ marginTop: 8 }}>
        <button className={`dw-button ${mode === 'registerAuthorization' ? '' : 'secondary'}`} onClick={() => setMode('registerAuthorization')}>
          Register
        </button>
        <button className={`dw-button ${mode === 'redeem' ? '' : 'secondary'}`} onClick={() => setMode('redeem')}>
          Redeem
        </button>
      </div>

      <div className="dw-grid" style={{ marginTop: 12 }}>
        <label className="dw-field">
          <span className="dw-label">Patient ID</span>
          <input className="dw-input" value={patientId} onChange={(event) => setPatientId(event.target.value)} />
        </label>
        <label className="dw-field">
          <span className="dw-label">Rx ID</span>
          <input className="dw-input" value={rxId} onChange={(event) => setRxId(event.target.value)} />
        </label>
        <label className="dw-field">
          <span className="dw-label">Pharmacy ID Hex</span>
          <input className="dw-input dw-code" value={pharmacyIdHex} onChange={(event) => setPharmacyIdHex(event.target.value)} />
        </label>
        <label className="dw-field">
          <span className="dw-label">Attestation Hash</span>
          <input className="dw-input dw-code" value={attestationHash} onChange={(event) => setAttestationHash(event.target.value)} />
        </label>
      </div>

      <div className="dw-inline" style={{ marginTop: 12 }}>
        <button className="dw-button" disabled={!status?.unlocked || !patientId || !rxId || !pharmacyIdHex} onClick={() => void submit()}>
          Submit Intent
        </button>
      </div>

      {jobId ? (
        <div className="dw-panel" style={{ marginTop: 12 }}>
          <div className="dw-kv">
            <div className="dw-kv-label">Queued Job</div>
            <div className="dw-kv-value dw-code">{jobId}</div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
};
