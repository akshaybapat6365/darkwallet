import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Cpu, Fingerprint, Radio, ShieldCheck } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ApiError,
  api,
  streamJobEvents,
  type AttestationChallengeResponse,
  type AttestationVerifyResponse,
  type HealthResponse,
  type JobStage,
  type PatientRecord,
} from '../lib/api';
import { sha256Hex } from '../lib/hash';
import { truncate } from '../lib/utils';
import { useWallet } from '../providers/WalletProvider';
import { useAppStore } from '../store/useAppStore';
import { Button } from './Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Progress } from './ui/progress';

type PickupDemoProps = {
  onHealth?: (health: HealthResponse | null) => void;
};

type UiError = {
  friendly: string;
  technical: string;
  requestId?: string;
  stage?: string;
};

const formatUiError = (err: unknown, stage?: string): UiError => {
  if (err instanceof ApiError) {
    const message = err.message || 'Request failed';
    let friendly = 'Request failed. Please try again.';
    if (err.status === 409 && /expired/i.test(message)) friendly = 'This step expired. Generate a new challenge and retry.';
    if (/signature/i.test(message)) friendly = 'Wallet signature verification failed. Re-sign and submit again.';
    if (/attestation/i.test(message)) friendly = 'Attestation requirement was not satisfied.';
    if (/nonce replay/i.test(message)) friendly = 'This signed request was already used. Create a new intent.';
    return {
      friendly,
      technical: message,
      requestId: err.requestId,
      stage,
    };
  }
  if (err instanceof Error) {
    return { friendly: err.message, technical: err.stack ?? err.message, stage };
  }
  return { friendly: 'Unexpected error', technical: String(err), stage };
};

type FieldProps = {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
};

const Field = ({ label, hint, value, onChange, placeholder, mono = false }: FieldProps) => (
  <label className="block">
    <div className="flex items-baseline justify-between gap-3">
      <div className="text-sm font-medium">{label}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
    <input
      className={`mt-1 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        mono ? 'font-mono' : ''
      }`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  </label>
);

type SelectOption = { value: string; label: string };
type SelectProps = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: SelectOption[];
};

const Select = ({ label, value, onChange, options }: SelectProps) => (
  <label className="block">
    <div className="text-sm font-medium">{label}</div>
    <select
      className="mt-1 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        Select…
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </label>
);

const sensitiveFieldPattern = /(secret|private.?key|mnemonic|seed)/i;

const redactSensitive = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (sensitiveFieldPattern.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = redactSensitive(nested);
  }
  return out;
};

const Result = ({ title, value }: { title: string; value: unknown }) => {
  if (!value) return null;
  const safeValue = redactSensitive(value);
  return (
    <div className="mt-3 rounded-md border border-border/70 bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <pre className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed">{JSON.stringify(safeValue, null, 2)}</pre>
    </div>
  );
};

const ErrorPanel = ({ error }: { error: UiError | null }) => {
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

const stageOrder: JobStage[] = ['QUEUED', 'AWAITING_SIGNATURE', 'PROOF_COMPUTING', 'TX_BUILDING', 'RELAYING', 'CONFIRMED'];

const stageLabels: Record<JobStage, string> = {
  QUEUED: 'Queued',
  AWAITING_SIGNATURE: 'Awaiting Wallet Signature',
  PROOF_COMPUTING: 'Computing ZK Proof',
  TX_BUILDING: 'Constructing Transaction',
  RELAYING: 'Relaying to Midnight',
  CONFIRMED: 'Block Confirmed',
  FAILED: 'Execution Failed',
};

const stageIcon = (stage: JobStage) => {
  switch (stage) {
    case 'QUEUED':
      return <Radio className="h-4 w-4" />;
    case 'AWAITING_SIGNATURE':
      return <ShieldCheck className="h-4 w-4" />;
    case 'PROOF_COMPUTING':
      return <Fingerprint className="h-4 w-4" />;
    case 'TX_BUILDING':
      return <Cpu className="h-4 w-4" />;
    case 'RELAYING':
      return <Radio className="h-4 w-4" />;
    case 'CONFIRMED':
      return <CheckCircle2 className="h-4 w-4" />;
    case 'FAILED':
      return <CheckCircle2 className="h-4 w-4" />;
    default:
      return null;
  }
};

const labelToBytes32Hex = async (label: string) => {
  const hex = await sha256Hex(label);
  return hex.slice(0, 64);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pendingJobStorageKey = 'midlight.pendingJobId';
const pendingIntentStorageKey = 'midlight.pendingIntentId';

const randomHexLine = (length: number) =>
  Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export const PickupDemo = ({ onHealth }: PickupDemoProps) => {
  const queryClient = useQueryClient();
  const { signPayloadHex } = useWallet();
  const wallet = useAppStore((s) => s.wallet);
  const [busy, setBusy] = React.useState(false);
  const [rehydratingJob, setRehydratingJob] = React.useState<string | null>(null);
  const [rehydratingIntent, setRehydratingIntent] = React.useState<string | null>(null);
  const [uiError, setUiError] = React.useState<UiError | null>(null);
  const [contractAddress, setContractAddress] = React.useState('');
  const [clinic, setClinic] = React.useState<unknown>(null);
  const [patients, setPatients] = React.useState<PatientRecord[]>([]);
  const [rxId, setRxId] = React.useState('1');
  const [pharmacyLabel, setPharmacyLabel] = React.useState('acme-pharmacy-1');
  const [pharmacyIdHex, setPharmacyIdHex] = React.useState('');
  const [selectedPatientId, setSelectedPatientId] = React.useState('');
  const [lastResult, setLastResult] = React.useState<unknown>(null);
  const [assetFingerprint, setAssetFingerprint] = React.useState('');
  const [challenge, setChallenge] = React.useState<AttestationChallengeResponse | null>(null);
  const [challengeSignature, setChallengeSignature] = React.useState<{
    walletAddress: string;
    signedPayloadHex: string;
    coseSign1Hex: string;
    coseKeyHex: string;
  } | null>(null);
  const [attestation, setAttestation] = React.useState<AttestationVerifyResponse | null>(null);

  const activeJob = useAppStore((s) => s.activeJob);
  const activeJobEvent = useAppStore((s) => s.activeJobEvent);
  const setActiveJob = useAppStore((s) => s.setActiveJob);
  const setActiveJobEvent = useAppStore((s) => s.setActiveJobEvent);
  const hashingLines = React.useMemo(() => Array.from({ length: 5 }, () => randomHexLine(56)), []);
  const didAttemptRehydrate = React.useRef(false);

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 8_000,
  });

  const indexedPickupsQuery = useQuery({
    queryKey: ['pickups-index'],
    queryFn: () => api.pickups(20),
    refetchInterval: 10_000,
  });

  React.useEffect(() => {
    onHealth?.(healthQuery.data ?? null);
  }, [healthQuery.data, onHealth]);

  React.useEffect(() => {
    if (healthQuery.data?.contractAddress && !contractAddress) {
      setContractAddress(healthQuery.data.contractAddress);
    }
  }, [contractAddress, healthQuery.data?.contractAddress]);

  React.useEffect(() => {
    let cancelled = false;
    labelToBytes32Hex(pharmacyLabel)
      .then((hex) => {
        if (!cancelled) setPharmacyIdHex(hex);
      })
      .catch(() => {
        if (!cancelled) setPharmacyIdHex('');
      });
    return () => {
      cancelled = true;
    };
  }, [pharmacyLabel]);

  React.useEffect(() => {
    if (didAttemptRehydrate.current) return;
    didAttemptRehydrate.current = true;
    const pendingJobId = localStorage.getItem(pendingJobStorageKey);
    const pendingIntentId = localStorage.getItem(pendingIntentStorageKey);
    if (pendingJobId) {
      setRehydratingJob(pendingJobId);
      return;
    }
    if (pendingIntentId) {
      setRehydratingIntent(pendingIntentId);
    }
  }, []);

  const patientOptions = React.useMemo(
    () =>
      patients.map((p) => ({
        value: p.patientId,
        label: `${p.patientId} (${truncate(p.patientPublicKeyHex, 18)})`,
      })),
    [patients],
  );

  const selectedPatient = React.useMemo(() => patients.find((p) => p.patientId === selectedPatientId) ?? null, [patients, selectedPatientId]);

  const clinicMutation = useMutation({
    mutationFn: api.clinicInit,
    onSuccess: (out) => {
      setClinic(out);
      void queryClient.invalidateQueries({ queryKey: ['health'] });
    },
  });

  const patientMutation = useMutation({
    mutationFn: api.patientCreate,
    onSuccess: (out) => {
      setPatients((prev) => [out, ...prev]);
      if (!selectedPatientId) setSelectedPatientId(out.patientId);
      void queryClient.invalidateQueries({ queryKey: ['health'] });
    },
  });

  const joinMutation = useMutation({
    mutationFn: api.join,
    onSuccess: (out) => {
      setContractAddress(out.contractAddress);
      void queryClient.invalidateQueries({ queryKey: ['health'] });
    },
  });

  const runAction = async <T,>(stage: string, fn: () => Promise<T>) => {
    setBusy(true);
    setUiError(null);
    setLastResult(null);
    try {
      const out = await fn();
      setLastResult(out);
      await queryClient.invalidateQueries({ queryKey: ['health'] });
      await queryClient.invalidateQueries({ queryKey: ['pickups-index'] });
      return out;
    } catch (err) {
      const formatted = formatUiError(err, stage);
      setUiError(formatted);
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const runJobById = React.useCallback(async (jobId: string) => {
    setBusy(true);
    setUiError(null);
    setLastResult(null);
    setActiveJob(null);
    setActiveJobEvent(null);
    localStorage.setItem(pendingJobStorageKey, jobId);

    let stopStreaming: (() => void) | null = null;
    try {
      stopStreaming = streamJobEvents(jobId, (event) => {
        setActiveJobEvent(event);
      });

      for (;;) {
        const out = await api.job(jobId);
        const job = out.job;
        if (!job) throw new Error('Job not found');
        setActiveJob(job);

        if (job.status === 'running') {
          await sleep(1_200);
          continue;
        }

        if (job.status === 'failed') {
          throw new Error(job.error?.message || 'Job failed');
        }

        setLastResult(job.result);
        await queryClient.invalidateQueries({ queryKey: ['health'] });
        await queryClient.invalidateQueries({ queryKey: ['pickups-index'] });
        return job.result;
      }
    } catch (err) {
      setUiError(formatUiError(err, 'job-run'));
      throw err;
    } finally {
      stopStreaming?.();
      localStorage.removeItem(pendingJobStorageKey);
      localStorage.removeItem(pendingIntentStorageKey);
      setRehydratingJob(null);
      setRehydratingIntent(null);
      setBusy(false);
    }
  }, [queryClient, setActiveJob, setActiveJobEvent]);

  React.useEffect(() => {
    if (!rehydratingJob) return;
    setActiveJobEvent({
      jobId: rehydratingJob,
      stage: 'QUEUED',
      progressPct: 1,
      message: 'We found a pending cryptographic proof. Resuming...',
      ts: new Date().toISOString(),
    });
    void runJobById(rehydratingJob).catch(() => {
      // Error panel is handled inside runJobById.
    });
  }, [rehydratingJob, runJobById, setActiveJobEvent]);

  const deploy = async () => {
    const started = await runAction('deploy', () => api.deployJob());
    await runJobById(started.jobId);
  };

  const runSecureIntent = async (action: 'registerAuthorization' | 'redeem') => {
    if (!selectedPatient) throw new Error('Select a patient first');
    const prepared = await runAction('intent-prepare', () =>
      api.intentPrepare(
        action === 'registerAuthorization'
          ? {
              action,
              body: {
                rxId,
                pharmacyIdHex,
                patientId: selectedPatient.patientId,
                patientPublicKeyHex: selectedPatient.patientPublicKeyHex,
                attestationHash: attestation?.attestationHash,
              },
            }
          : {
              action,
              body: {
                patientId: selectedPatient.patientId,
                rxId,
                pharmacyIdHex,
                attestationHash: attestation?.attestationHash,
              },
            },
      ),
    );
    localStorage.setItem(pendingIntentStorageKey, prepared.intentId);

    setActiveJobEvent({
      jobId: prepared.intentId,
      stage: 'AWAITING_SIGNATURE',
      progressPct: 8,
      message: 'Awaiting wallet signature',
      ts: new Date().toISOString(),
    });

    const signed = await runAction('intent-sign', () => signPayloadHex(prepared.payloadHex));
    const submitted = await runAction('intent-submit', () =>
      api.intentSubmit({
        intentId: prepared.intentId,
        walletAddress: signed.walletAddress,
        signedPayloadHex: signed.signedPayloadHex,
        coseSign1Hex: signed.coseSign1Hex,
        coseKeyHex: signed.coseKeyHex,
      }),
    );
    await runJobById(submitted.jobId);
  };

  const register = async () => {
    if (!selectedPatient) throw new Error('Select a patient first');
    if (healthQuery.data?.features?.enableIntentSigning) {
      await runSecureIntent('registerAuthorization');
      return;
    }
    const out = await runAction('register-legacy', () =>
      api.registerAuthorizationJob({ rxId, pharmacyIdHex, patientId: selectedPatient.patientId }),
    );
    await runJobById(out.jobId);
  };

  const redeem = async () => {
    if (!selectedPatient) throw new Error('Select a patient first');
    if (healthQuery.data?.features?.enableIntentSigning) {
      await runSecureIntent('redeem');
      return;
    }
    const out = await runAction('redeem-legacy', () => api.redeemJob({ patientId: selectedPatient.patientId, rxId, pharmacyIdHex }));
    await runJobById(out.jobId);
  };

  const check = async () => {
    if (!selectedPatient) throw new Error('Select a patient first');
    await runAction('check', () =>
      api.pharmacyCheck({
        patientId: selectedPatient.patientId,
        rxId,
        pharmacyIdHex,
        attestationHash: attestation?.attestationHash,
      }),
    );
  };

  const generateChallenge = async () => {
    const midnightAddress = selectedPatient?.patientPublicKeyHex ?? null;
    const out = await runAction('attestation-challenge', () =>
      api.attestationChallenge({
        assetFingerprint,
        walletAddress: wallet.address ?? undefined,
        midnightAddress: midnightAddress ?? undefined,
      }),
    );
    setChallenge(out);
    setChallengeSignature(null);
    setAttestation(null);
  };

  const signChallenge = async () => {
    if (!challenge) throw new Error('Generate challenge first');
    const signed = await runAction('attestation-sign', () => signPayloadHex(challenge.payloadHex));
    setChallengeSignature(signed);
  };

  const verifyChallenge = async () => {
    if (!challenge || !challengeSignature) throw new Error('Generate and sign challenge first');
    const verified = await runAction('attestation-verify', () =>
      api.attestationVerify({
        challengeId: challenge.challengeId,
        walletAddress: challengeSignature.walletAddress,
        assetFingerprint,
        midnightAddress: selectedPatient?.patientPublicKeyHex,
        signedPayloadHex: challengeSignature.signedPayloadHex,
        coseSign1Hex: challengeSignature.coseSign1Hex,
        coseKeyHex: challengeSignature.coseKeyHex,
      }),
    );
    setAttestation(verified);
  };

  const resetAttestation = () => {
    setChallenge(null);
    setChallengeSignature(null);
    setAttestation(null);
  };

  const stageIndex = activeJob?.stage ? stageOrder.indexOf(activeJob.stage) : -1;
  const progress = activeJob?.progressPct ?? (activeJob?.status === 'failed' ? 100 : 0);

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Execution Runbook</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
          <div>
            1. <span className="font-mono">npm install</span>
          </div>
          <div>
            2. <span className="font-mono">docker compose -f services/prover/standalone.yml up -d</span>
          </div>
          <div>
            3. <span className="font-mono">MIDLIGHT_REDIS_URL=redis://127.0.0.1:6379 npm run dev:demo</span>
          </div>
          <div>
            4. Optional DB:{' '}
            <span className="font-mono">MIDLIGHT_DATABASE_URL=postgres://midlight:midlight@127.0.0.1:5432/midlight</span>
          </div>
        </CardContent>
      </Card>

      <ErrorPanel error={uiError} />

      {rehydratingIntent && !rehydratingJob ? (
        <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
          We found a pending cryptographic proof intent (<span className="font-mono">{truncate(rehydratingIntent, 20)}</span>). Resume by signing the next register/redeem action.
        </div>
      ) : null}

      <AnimatePresence>
        {activeJob ? (
          <motion.div
            key={activeJob.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="rounded-lg border border-border/70 bg-card/80 p-4"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Cryptographic Pipeline</div>
                <div className="font-medium">{stageLabels[activeJob.stage]}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                job <span className="font-mono">{activeJob.id}</span>
              </div>
            </div>

            <Progress value={progress} className="mb-4" />

            <div className="grid gap-2 md:grid-cols-3">
              {stageOrder.map((stage, idx) => {
                const done = stageIndex >= idx || activeJob.stage === 'FAILED';
                const current = activeJob.stage === stage;
                return (
                  <motion.div
                    key={stage}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: done ? 1 : 0.55, y: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    className={`rounded-md border p-2 text-xs ${current ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/70'}`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      {stageIcon(stage)}
                      {stageLabels[stage]}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {activeJob.stage === 'PROOF_COMPUTING' ? (
              <div className="mt-3 overflow-hidden rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-primary/80">Cryptographic Hashing Stream</div>
                <div className="space-y-1 font-mono text-[11px] text-primary/80">
                  {hashingLines.map((line, idx) => (
                    <motion.div
                      key={`${line}-${idx}`}
                      initial={{ opacity: 0.2, x: -8 }}
                      animate={{ opacity: [0.25, 0.95, 0.35], x: [0, 4, 0] }}
                      transition={{ duration: 1.2 + idx * 0.08, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      {line}
                    </motion.div>
                  ))}
                </div>
              </div>
            ) : null}

            {activeJobEvent?.message ? (
              <div className="mt-3 text-xs text-muted-foreground">
                <span className="font-medium">Latest:</span> {activeJobEvent.message}
              </div>
            ) : null}

            {rehydratingJob && !activeJob ? (
              <div className="mt-3 text-xs text-muted-foreground">We found a pending cryptographic proof. Resuming...</div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Prover health:{' '}
              <span className="font-medium">{healthQuery.data?.ok ? 'ok' : healthQuery.isFetching ? 'checking…' : 'unknown'}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Intent signing: <span className="font-medium">{healthQuery.data?.features?.enableIntentSigning ? 'on' : 'off'}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Attestation enforcement:{' '}
              <span className="font-medium">{healthQuery.data?.features?.enableAttestationEnforcement ? 'on' : 'off'}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void runAction('init-clinic', () => clinicMutation.mutateAsync())} disabled={busy}>
                Init Clinic
              </Button>
              <Button variant="secondary" onClick={() => void runAction('new-patient', () => patientMutation.mutateAsync())} disabled={busy}>
                New Patient
              </Button>
              <Button variant="outline" onClick={() => void queryClient.invalidateQueries({ queryKey: ['health'] })} disabled={busy}>
                Refresh
              </Button>
            </div>

            <Button onClick={() => void deploy()} disabled={busy}>
              Deploy
            </Button>

            <Field
              label="Contract Address"
              hint="Paste to join an existing deployment"
              value={contractAddress}
              onChange={setContractAddress}
              placeholder="0x…"
              mono
            />
            <Button
              variant="outline"
              onClick={() => void runAction('join-contract', () => joinMutation.mutateAsync(contractAddress.trim()))}
              disabled={busy || !contractAddress.trim()}
            >
              Join
            </Button>

            <Result title="Clinic" value={clinic} />
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Attestation Wizard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Asset Fingerprint"
              hint="Cardano asset fingerprint used for private access gating"
              value={assetFingerprint}
              onChange={setAssetFingerprint}
              placeholder="asset1..."
              mono
            />

            <div className="grid grid-cols-1 gap-2 md:grid-cols-4" role="group" aria-label="Attestation steps">
              <Button
                onClick={() => void generateChallenge()}
                disabled={busy || !assetFingerprint.trim()}
                aria-label="Generate attestation challenge"
              >
                1. Challenge
              </Button>
              <Button
                variant="secondary"
                onClick={() => void signChallenge()}
                disabled={busy || !challenge}
                aria-label="Sign attestation challenge with wallet"
              >
                2. Sign
              </Button>
              <Button
                variant="outline"
                onClick={() => void verifyChallenge()}
                disabled={busy || !challengeSignature}
                aria-label="Verify signed attestation challenge"
              >
                3. Verify
              </Button>
              <Button variant="ghost" onClick={resetAttestation} disabled={busy} aria-label="Reset attestation flow">
                Reset
              </Button>
            </div>

            <div className="rounded-md border border-border/70 bg-background/60 p-3 text-xs" data-testid="attestation-step-status">
              <div className="font-medium">Step status</div>
              <div className="mt-2 text-muted-foreground">Challenge: {challenge ? 'ready' : 'pending'}</div>
              <div className="text-muted-foreground">Signature: {challengeSignature ? 'captured' : 'pending'}</div>
              <div className="text-muted-foreground">Attestation: {attestation ? 'verified' : 'pending'}</div>
              {attestation ? (
                <div className="mt-2 text-muted-foreground">
                  hash: <span className="font-mono">{truncate(attestation.attestationHash, 34)}</span>
                </div>
              ) : null}
            </div>

            <Result title="Attestation Challenge" value={challenge} />
            <Result title="Attestation Proof" value={attestation} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pickup Flow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Rx ID" hint="uint64 (base-10)" value={rxId} onChange={setRxId} placeholder="1" mono />
            <Field
              label="Pharmacy Label"
              hint="Hashed to Bytes32 via SHA-256"
              value={pharmacyLabel}
              onChange={setPharmacyLabel}
              placeholder="acme-pharmacy-1"
            />
          </div>

          <div className="rounded-md border border-border/70 bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Derived Pharmacy ID (Bytes32 hex)</div>
            <div className="mt-1 break-all font-mono text-xs">{pharmacyIdHex || '…'}</div>
          </div>

          <Select label="Patient" value={selectedPatientId} onChange={setSelectedPatientId} options={patientOptions} />

          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Button onClick={() => void register()} disabled={busy || !selectedPatientId}>
              Clinic: Register
            </Button>
            <Button variant="secondary" onClick={() => void redeem()} disabled={busy || !selectedPatientId}>
              Patient: Redeem
            </Button>
            <Button variant="outline" onClick={() => void check()} disabled={busy || !selectedPatientId}>
              Pharmacy: Check
            </Button>
          </div>

          <Result title="Result" value={lastResult} />

          <div className="rounded-md border border-border/70 bg-card/60 p-3">
            <div className="text-sm font-medium">Indexed Pickups (PostgreSQL)</div>
            <div className="mt-2 space-y-2">
              {(indexedPickupsQuery.data?.pickups ?? []).length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No indexed pickups yet. Set <span className="font-mono">MIDLIGHT_DATABASE_URL</span> to persist records.
                </div>
              ) : (
                indexedPickupsQuery.data?.pickups.slice(0, 5).map((pickup) => (
                  <div key={pickup.commitmentHex} className="rounded border border-border/60 bg-background/50 p-2 text-xs">
                    <div className="font-mono">{truncate(pickup.commitmentHex, 30)}</div>
                    <div className="mt-1 text-muted-foreground">
                      rx {pickup.rxId} · block {pickup.registeredBlockHeight} · redeemed {pickup.redeemedTxId ? 'yes' : 'no'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
};
