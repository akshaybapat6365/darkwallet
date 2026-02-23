import { Panel } from '@ext/components/Panel';
import { useVault } from '@ext/shared/hooks/useVault';

export const ReceivePage = () => {
  const { status } = useVault();
  const address = status?.publicAddress;

  return (
    <Panel>
      <h2 className="dw-heading">Receive</h2>
      <p className="dw-sub">Share this address to receive assets into your extension wallet.</p>

      {address ? (
        <>
          <div className="dw-panel">
            <div className="dw-kv">
              <div className="dw-kv-label">Cardano Address</div>
              <div className="dw-kv-value dw-code">{address}</div>
            </div>
          </div>
          <div className="dw-inline" style={{ marginTop: 12 }}>
            <button className="dw-button" onClick={() => void navigator.clipboard.writeText(address)}>
              Copy Address
            </button>
          </div>
        </>
      ) : (
        <div className="dw-error">Initialize and unlock vault to view receive address.</div>
      )}
    </Panel>
  );
};
