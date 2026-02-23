import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '../components/Button';
import { ErrorPanel, formatUiError, type UiError } from '../components/ui/ErrorPanel';
import { Field } from '../components/ui/Field';
import { ResultDisplay } from '../components/ui/ResultDisplay';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  api,
  type AttestationChallengeResponse,
  type AttestationVerifyResponse,
} from '../lib/api';
import { useWallet } from '../providers/WalletProvider';
import { useAppStore } from '../store/useAppStore';
import { truncate } from '../lib/utils';

const attestationStorageKey = 'darkwallet.attestation';

const formatCountdown = (remainingMs: number): string => {
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const sec = String(totalSec % 60).padStart(2, '0');
  return `${min}:${sec}`;
};

export const AttestationPage = () => {
  const { signPayloadHex } = useWallet();
  const wallet = useAppStore((s) => s.wallet);
  const [assetFingerprint, setAssetFingerprint] = React.useState('');
  const [challenge, setChallenge] = React.useState<AttestationChallengeResponse | null>(null);
  const [signed, setSigned] = React.useState<{
    walletAddress: string;
    signedPayloadHex: string;
    coseSign1Hex: string;
    coseKeyHex: string;
  } | null>(null);
  const [attestation, setAttestation] = React.useState<AttestationVerifyResponse | null>(null);
  const [uiError, setUiError] = React.useState<UiError | null>(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  React.useEffect(() => {
    const raw = localStorage.getItem(attestationStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as AttestationVerifyResponse;
      setAttestation(parsed);
      setAssetFingerprint(parsed.oracleEnvelope.payload.assetFingerprint);
    } catch {
      localStorage.removeItem(attestationStorageKey);
    }
  }, []);

  React.useEffect(() => {
    if (!attestation?.expiresAt) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [attestation?.expiresAt]);

  const challengeMutation = useMutation({
    mutationFn: () =>
      api.attestationChallenge({
        assetFingerprint,
        walletAddress: wallet.address ?? undefined,
      }),
    onSuccess: (out) => {
      setChallenge(out);
      setSigned(null);
      setUiError(null);
      toast.message('Attestation challenge generated');
    },
    onError: (err) => setUiError(formatUiError(err, 'attestation-challenge')),
  });

  const signMutation = useMutation({
    mutationFn: async () => {
      if (!challenge) throw new Error('Generate challenge first');
      return await signPayloadHex(challenge.payloadHex);
    },
    onSuccess: (out) => {
      setSigned(out);
      setUiError(null);
      toast.message('Challenge signed in wallet');
    },
    onError: (err) => setUiError(formatUiError(err, 'attestation-sign')),
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      if (!challenge || !signed) throw new Error('Generate and sign challenge first');
      return await api.attestationVerify({
        challengeId: challenge.challengeId,
        walletAddress: signed.walletAddress,
        assetFingerprint,
        signedPayloadHex: signed.signedPayloadHex,
        coseSign1Hex: signed.coseSign1Hex,
        coseKeyHex: signed.coseKeyHex,
      });
    },
    onSuccess: (out) => {
      setAttestation(out);
      localStorage.setItem(attestationStorageKey, JSON.stringify(out));
      setUiError(null);
      toast.success('Attestation verified');
    },
    onError: (err) => setUiError(formatUiError(err, 'attestation-verify')),
  });

  const reset = () => {
    setChallenge(null);
    setSigned(null);
    setAttestation(null);
    setUiError(null);
    localStorage.removeItem(attestationStorageKey);
  };

  const busy = challengeMutation.isPending || signMutation.isPending || verifyMutation.isPending;

  const remainingMs = React.useMemo(() => {
    if (!attestation?.expiresAt) return null;
    const expiresAtMs = Date.parse(attestation.expiresAt);
    if (!Number.isFinite(expiresAtMs)) return null;
    return expiresAtMs - nowMs;
  }, [attestation?.expiresAt, nowMs]);

  const isExpired = remainingMs != null && remainingMs <= 0;
  const isUrgent = remainingMs != null && remainingMs > 0 && remainingMs < 60_000;
  const isWarning = remainingMs != null && remainingMs > 0 && remainingMs < 5 * 60_000;

  return (
    <section className="space-y-4 page-enter">
      <Card className="glass">
        <CardHeader>
          <CardTitle>Asset Attestation Wizard</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ErrorPanel error={uiError} />

          {isExpired ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              Your attestation expired. Generate a new challenge to continue secure intent signing.
            </div>
          ) : isUrgent ? (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/15 p-3 text-sm">
              Attestation expires in <strong>{formatCountdown(remainingMs ?? 0)}</strong>. Re-attest now to avoid flow interruption.
            </div>
          ) : isWarning ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Attestation expires in {formatCountdown(remainingMs ?? 0)}.
            </div>
          ) : null}

          <Field
            label="Asset Fingerprint"
            hint="Cardano fingerprint proving access policy"
            value={assetFingerprint}
            onChange={setAssetFingerprint}
            placeholder="asset1..."
            mono
          />

          <div className="grid grid-cols-1 gap-2 md:grid-cols-4" role="group" aria-label="Attestation steps">
            <Button
              onClick={() => challengeMutation.mutate()}
              disabled={busy || !assetFingerprint.trim()}
              aria-label="Generate attestation challenge"
            >
              1. Challenge
            </Button>
            <Button
              variant="secondary"
              onClick={() => signMutation.mutate()}
              disabled={busy || !challenge}
              aria-label="Sign attestation challenge with wallet"
            >
              2. Sign
            </Button>
            <Button
              variant="outline"
              onClick={() => verifyMutation.mutate()}
              disabled={busy || !signed}
              aria-label="Verify signed attestation challenge"
            >
              3. Verify
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              Reset
            </Button>
          </div>

          <div className="rounded-md border border-border/70 bg-background/60 p-3 text-xs" data-testid="attestation-step-status">
            <div className="font-medium">Step status</div>
            <div className="mt-2 text-muted-foreground">Challenge: {challenge ? 'ready' : 'pending'}</div>
            <div className="text-muted-foreground">Signature: {signed ? 'captured' : 'pending'}</div>
            <div className="text-muted-foreground">Attestation: {attestation ? 'verified' : 'pending'}</div>
            {attestation ? (
              <>
                <div className="mt-2 text-muted-foreground">
                  hash: <span className="font-mono">{truncate(attestation.attestationHash, 34)}</span>
                </div>
                <div className="text-muted-foreground">
                  expires in:{' '}
                  <span className={isUrgent ? 'font-semibold text-amber-300' : isWarning ? 'text-amber-400' : ''}>
                    {remainingMs == null ? 'unknown' : formatCountdown(remainingMs)}
                  </span>
                </div>
              </>
            ) : null}
          </div>

          <ResultDisplay title="Challenge" value={challenge} />
          <ResultDisplay title="Attestation Proof" value={attestation} />
        </CardContent>
      </Card>
    </section>
  );
};
