import { useState } from 'react';

import { Panel } from '@ext/components/Panel';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';
import { extensionFetch } from '@ext/shared/services/http';
import { useVault } from '@ext/shared/hooks/useVault';

type ChallengeResponse = {
  challengeId: string;
  nonce: string;
  payloadHex: string;
};

type VerifyResponse = {
  attestationHash: string;
  verified: boolean;
  expiresAt: string;
};

export const AttestationPage = () => {
  const { status } = useVault();
  const [assetFingerprint, setAssetFingerprint] = useState('');
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateChallenge = async () => {
    try {
      setError(null);
      setResult(null);
      const response = await extensionFetch<ChallengeResponse>('/api/v1/attestations/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetFingerprint }),
      });
      setChallenge(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Challenge creation failed');
    }
  };

  const verifyChallenge = async () => {
    try {
      if (!challenge || !status?.publicAddress) throw new Error('Challenge and unlocked wallet are required');
      setError(null);
      const signature = await sendRuntimeMessage<{ signature: string; key: string }>({
        kind: 'CIP30_REQUEST',
        origin: 'chrome-extension://darkwallet',
        method: 'signData',
        params: [status.publicAddress, challenge.payloadHex],
      });

      const response = await extensionFetch<VerifyResponse>('/api/v1/attestations/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          walletAddress: status.publicAddress,
          assetFingerprint,
          signedPayloadHex: challenge.payloadHex,
          coseSign1Hex: signature.signature,
          coseKeyHex: signature.key,
        }),
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attestation verification failed');
    }
  };

  return (
    <Panel>
      <h2 className="dw-heading">Attestation</h2>
      <p className="dw-sub">Oracle-backed proof gate for private prescription actions.</p>

      {!status?.unlocked ? <div className="dw-error">Unlock vault before attestation signing.</div> : null}
      {error ? <div className="dw-error">{error}</div> : null}

      <label className="dw-field" style={{ marginTop: 10 }}>
        <span className="dw-label">Asset fingerprint</span>
        <input className="dw-input" value={assetFingerprint} onChange={(event) => setAssetFingerprint(event.target.value)} />
      </label>

      <div className="dw-inline" style={{ marginTop: 12 }}>
        <button className="dw-button" disabled={!assetFingerprint} onClick={() => void generateChallenge()}>
          Generate Challenge
        </button>
        <button className="dw-button secondary" disabled={!challenge || !status?.unlocked} onClick={() => void verifyChallenge()}>
          Sign + Verify
        </button>
      </div>

      {challenge ? (
        <div className="dw-panel" style={{ marginTop: 12 }}>
          <div className="dw-kv">
            <div className="dw-kv-label">Challenge</div>
            <div className="dw-kv-value dw-code">{challenge.challengeId}</div>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="dw-panel" style={{ marginTop: 12 }}>
          <div className="dw-kv">
            <div className="dw-kv-label">Attestation Hash</div>
            <div className="dw-kv-value dw-code">{result.attestationHash}</div>
            <div className="dw-kv-label">Expires</div>
            <div className="dw-kv-value">{new Date(result.expiresAt).toLocaleString()}</div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
};
