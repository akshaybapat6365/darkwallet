import type { ApiError } from '../../lib/api';

export type UiError = {
  friendly: string;
  technical: string;
  requestId?: string;
  stage?: string;
};

export const formatUiError = (err: unknown, stage?: string): UiError => {
  if (err instanceof Error && 'status' in err) {
    const apiErr = err as ApiError;
    const message = apiErr.message || 'Request failed';
    let friendly = 'Request failed. Please try again.';
    if (apiErr.status === 409 && /expired/i.test(message)) friendly = 'This step expired. Generate a new challenge and retry.';
    if (/signature/i.test(message)) friendly = 'Wallet signature verification failed. Re-sign and submit again.';
    if (/attestation/i.test(message)) friendly = 'Attestation requirement was not satisfied.';
    if (/nonce replay/i.test(message)) friendly = 'This signed request was already used. Create a new intent.';
    return {
      friendly,
      technical: message,
      requestId: apiErr.requestId,
      stage,
    };
  }

  if (err instanceof Error) {
    return { friendly: err.message, technical: err.stack ?? err.message, stage };
  }
  return { friendly: 'Unexpected error', technical: String(err), stage };
};

export const ErrorPanel = ({ error }: { error: UiError | null }) => {
  if (!error) return null;
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" data-testid="error-panel">
      <div className="font-medium text-destructive">{error.friendly}</div>
      <details className="mt-2 text-xs" data-testid="error-details">
        <summary className="cursor-pointer text-muted-foreground">Technical diagnostics</summary>
        <div className="mt-2 space-y-1 font-mono text-xs">
          {error.stage ? <div>stage: {error.stage}</div> : null}
          {error.requestId ? <div>requestId: {error.requestId}</div> : null}
          <pre className="whitespace-pre-wrap break-words">{error.technical}</pre>
        </div>
      </details>
    </div>
  );
};
