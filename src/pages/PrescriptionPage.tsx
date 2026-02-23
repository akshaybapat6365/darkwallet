import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '../components/Button';
import { JobTracker } from '../components/jobs/JobTracker';
import { ErrorPanel, formatUiError, type UiError } from '../components/ui/ErrorPanel';
import { Field, SelectField } from '../components/ui/Field';
import { ResultDisplay } from '../components/ui/ResultDisplay';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { api, streamJobEvents, type JobSnapshot, type PatientRecord } from '../lib/api';
import { sha256Hex } from '../lib/hash';
import { truncate } from '../lib/utils';
import { useWallet } from '../providers/WalletProvider';
import { useAppStore } from '../store/useAppStore';

const pendingJobStorageKey = 'darkwallet.pendingJobId';
const pendingIntentStorageKey = 'darkwallet.pendingIntentId';
const attestationStorageKey = 'darkwallet.attestation';
const patientsStorageKey = 'darkwallet.patients';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const labelToBytes32Hex = async (label: string) => {
  const hex = await sha256Hex(label);
  return hex.slice(0, 64);
};

export const PrescriptionPage = () => {
  const queryClient = useQueryClient();
  const { signPayloadHex } = useWallet();
  const activeJob = useAppStore((s) => s.activeJob);
  const activeJobEvent = useAppStore((s) => s.activeJobEvent);
  const setActiveJob = useAppStore((s) => s.setActiveJob);
  const setActiveJobEvent = useAppStore((s) => s.setActiveJobEvent);

  const [busy, setBusy] = React.useState(false);
  const [uiError, setUiError] = React.useState<UiError | null>(null);
  const [lastResult, setLastResult] = React.useState<unknown>(null);
  const [rxId, setRxId] = React.useState('1');
  const [pharmacyLabel, setPharmacyLabel] = React.useState('acme-pharmacy-1');
  const [pharmacyIdHex, setPharmacyIdHex] = React.useState('');
  const [attestationHash, setAttestationHash] = React.useState('');
  const [attestationExpiresAt, setAttestationExpiresAt] = React.useState<string | null>(null);
  const [patients, setPatients] = React.useState<PatientRecord[]>([]);
  const [selectedPatientId, setSelectedPatientId] = React.useState('');

  const health = useQuery({
    queryKey: ['health-prescriptions'],
    queryFn: api.health,
    refetchInterval: 8_000,
  });

  React.useEffect(() => {
    const rawAttestation = localStorage.getItem(attestationStorageKey);
    if (rawAttestation) {
      try {
        const parsed = JSON.parse(rawAttestation) as { attestationHash?: string; expiresAt?: string };
        if (parsed.attestationHash) setAttestationHash(parsed.attestationHash);
        if (parsed.expiresAt) setAttestationExpiresAt(parsed.expiresAt);
      } catch {
        // ignore
      }
    }

    const rawPatients = localStorage.getItem(patientsStorageKey);
    if (rawPatients) {
      try {
        const parsed = JSON.parse(rawPatients) as PatientRecord[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPatients(parsed);
          setSelectedPatientId(parsed[0].patientId);
        }
      } catch {
        // ignore
      }
    }
  }, []);

  React.useEffect(() => {
    localStorage.setItem(patientsStorageKey, JSON.stringify(patients));
  }, [patients]);

  const attestationExpired = React.useMemo(() => {
    if (!attestationExpiresAt) return false;
    const expires = Date.parse(attestationExpiresAt);
    return Number.isFinite(expires) ? expires <= Date.now() : false;
  }, [attestationExpiresAt]);

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

  const patientOptions = React.useMemo(
    () =>
      patients.map((patient) => ({
        value: patient.patientId,
        label: `${patient.patientId} (${truncate(patient.patientPublicKeyHex, 18)})`,
      })),
    [patients],
  );

  const selectedPatient = React.useMemo(() => patients.find((p) => p.patientId === selectedPatientId) ?? null, [patients, selectedPatientId]);

  const patientMutation = useMutation({
    mutationFn: api.patientCreate,
    onSuccess: (out) => {
      setPatients((prev) => [out, ...prev]);
      if (!selectedPatientId) setSelectedPatientId(out.patientId);
      setUiError(null);
      toast.message('Patient identity created');
    },
    onError: (err) => setUiError(formatUiError(err, 'create-patient')),
  });

  const runAction = async <T,>(stage: string, fn: () => Promise<T>) => {
    setBusy(true);
    setUiError(null);
    setLastResult(null);
    try {
      const out = await fn();
      setLastResult(out);
      return out;
    } catch (err) {
      setUiError(formatUiError(err, stage));
      if (err && typeof err === 'object') {
        (err as { __uiHandled?: boolean }).__uiHandled = true;
      }
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
          await sleep(1_000);
          continue;
        }
        if (job.status === 'failed') throw new Error(job.error?.message || 'Job failed');

        setLastResult(job.result);
        await queryClient.invalidateQueries({ queryKey: ['health-prescriptions'] });
        toast.success('Job confirmed on Midnight');
        return job.result;
      }
    } catch (err) {
      setUiError(formatUiError(err, 'job-run'));
      toast.error(err instanceof Error ? err.message : 'Job execution failed');
      throw err;
    } finally {
      stopStreaming?.();
      localStorage.removeItem(pendingJobStorageKey);
      localStorage.removeItem(pendingIntentStorageKey);
      setBusy(false);
    }
  }, [queryClient, setActiveJob, setActiveJobEvent]);

  React.useEffect(() => {
    const pendingJobId = localStorage.getItem(pendingJobStorageKey);
    if (!pendingJobId) return;
    setActiveJobEvent({
      jobId: pendingJobId,
      stage: 'QUEUED',
      progressPct: 1,
      message: 'We found a pending cryptographic proof. Resuming...',
      ts: new Date().toISOString(),
    });
    void runJobById(pendingJobId).catch(() => {
      // handled in runJobById
    });
  }, [runJobById, setActiveJobEvent]);

  const runSecureIntent = async (action: 'registerAuthorization' | 'redeem') => {
    if (!selectedPatient) throw new Error('Select a patient first');
    if (attestationExpired) {
      throw new Error('Attestation expired. Re-run attestation flow.');
    }
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
                attestationHash: attestationHash || undefined,
              },
            }
          : {
              action,
              body: {
                patientId: selectedPatient.patientId,
                rxId,
                pharmacyIdHex,
                attestationHash: attestationHash || undefined,
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
    toast.message('Intent prepared. Sign in wallet to continue.');

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
    try {
      if (!selectedPatient) throw new Error('Select a patient first');
      if (health.data?.features.enableIntentSigning) {
        await runSecureIntent('registerAuthorization');
        return;
      }
      const started = await runAction('register-legacy', () =>
        api.registerAuthorizationJob({
          rxId,
          pharmacyIdHex,
          patientId: selectedPatient.patientId,
          patientPublicKeyHex: selectedPatient.patientPublicKeyHex,
        }),
      );
      await runJobById(started.jobId);
    } catch (err) {
      if (!(err && typeof err === 'object' && (err as { __uiHandled?: boolean }).__uiHandled)) {
        setUiError(formatUiError(err, 'register'));
      }
    }
  };

  const redeem = async () => {
    try {
      if (!selectedPatient) throw new Error('Select a patient first');
      if (health.data?.features.enableIntentSigning) {
        await runSecureIntent('redeem');
        return;
      }
      const started = await runAction('redeem-legacy', () =>
        api.redeemJob({
          patientId: selectedPatient.patientId,
          rxId,
          pharmacyIdHex,
        }),
      );
      await runJobById(started.jobId);
    } catch (err) {
      if (!(err && typeof err === 'object' && (err as { __uiHandled?: boolean }).__uiHandled)) {
        setUiError(formatUiError(err, 'redeem'));
      }
    }
  };

  const check = async () => {
    try {
      if (!selectedPatient) throw new Error('Select a patient first');
      await runAction('check', () =>
        api.pharmacyCheck({
          patientId: selectedPatient.patientId,
          rxId,
          pharmacyIdHex,
          attestationHash: attestationHash || undefined,
        }),
      );
    } catch (err) {
      if (!(err && typeof err === 'object' && (err as { __uiHandled?: boolean }).__uiHandled)) {
        setUiError(formatUiError(err, 'check'));
      }
    }
  };

  return (
    <section className="space-y-4 page-enter">
      <ErrorPanel error={uiError} />
      <JobTracker job={activeJob as JobSnapshot | null} event={activeJobEvent} />

      <Card className="glass">
        <CardHeader>
          <CardTitle>Prescription Workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!health.data?.contractAddress ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Contract is not joined yet. Use the <strong>/dev</strong> page for initialization and contract join.
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => patientMutation.mutate()}
              disabled={busy || patientMutation.isPending}
            >
              New Patient
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Rx ID" hint="uint64" value={rxId} onChange={setRxId} placeholder="1" mono />
            <Field
              label="Pharmacy Label"
              hint="Hashed to Bytes32"
              value={pharmacyLabel}
              onChange={setPharmacyLabel}
              placeholder="acme-pharmacy-1"
            />
          </div>

          <div className="rounded-md border border-border/70 bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Derived Pharmacy ID (Bytes32 hex)</div>
            <div className="mt-1 break-all font-mono text-xs">{pharmacyIdHex || '...'}</div>
          </div>

          <Field
            label="Attestation Hash"
            hint="Optional unless policy enforces it"
            value={attestationHash}
            onChange={(value) => {
              setAttestationHash(value);
              if (!value.trim()) setAttestationExpiresAt(null);
            }}
            placeholder="attestation-hash"
            mono
          />

          {attestationExpired ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Stored attestation is expired. Re-run attestation flow before submitting a secure intent.
            </div>
          ) : null}

          <SelectField label="Patient" value={selectedPatientId} onChange={setSelectedPatientId} options={patientOptions} />

          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Button onClick={() => void register()} disabled={busy || !selectedPatient}>
              Register Authorization
            </Button>
            <Button variant="secondary" onClick={() => void redeem()} disabled={busy || !selectedPatient}>
              Redeem Pickup
            </Button>
            <Button variant="outline" onClick={() => void check()} disabled={busy || !selectedPatient}>
              Check Status
            </Button>
          </div>

          <ResultDisplay title="Latest Result" value={lastResult} />
        </CardContent>
      </Card>
    </section>
  );
};
