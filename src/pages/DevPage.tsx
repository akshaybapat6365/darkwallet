import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '../components/Button';
import { ErrorPanel, formatUiError, type UiError } from '../components/ui/ErrorPanel';
import { Field } from '../components/ui/Field';
import { ResultDisplay } from '../components/ui/ResultDisplay';
import { Skeleton } from '../components/ui/Skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { api } from '../lib/api';

export const DevPage = () => {
  const queryClient = useQueryClient();
  const [uiError, setUiError] = React.useState<UiError | null>(null);
  const [lastResult, setLastResult] = React.useState<unknown>(null);
  const [contractAddress, setContractAddress] = React.useState('');

  const health = useQuery({
    queryKey: ['health-dev'],
    queryFn: api.health,
    refetchInterval: 8_000,
  });

  React.useEffect(() => {
    if (health.data?.contractAddress) setContractAddress(health.data.contractAddress);
  }, [health.data?.contractAddress]);

  const run = async <T,>(stage: string, fn: () => Promise<T>) => {
    try {
      setUiError(null);
      const out = await fn();
      setLastResult(out);
      await queryClient.invalidateQueries({ queryKey: ['health-dev'] });
      return out;
    } catch (err) {
      setUiError(formatUiError(err, stage));
      throw err;
    }
  };

  const clinic = useMutation({
    mutationFn: api.clinicInit,
    onSuccess: (out) => {
      setLastResult(out);
      void queryClient.invalidateQueries({ queryKey: ['health-dev'] });
    },
    onError: (err) => setUiError(formatUiError(err, 'init-clinic')),
  });

  const patient = useMutation({
    mutationFn: api.patientCreate,
    onSuccess: (out) => setLastResult(out),
    onError: (err) => setUiError(formatUiError(err, 'create-patient')),
  });

  if (health.isLoading) {
    return (
      <section className="space-y-4 page-enter" aria-busy="true" aria-live="polite">
        <Card className="glass">
          <CardHeader>
            <Skeleton className="h-6 w-44" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-4 page-enter">
      <ErrorPanel error={uiError} />
      <Card className="glass">
        <CardHeader>
          <CardTitle>Developer Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => clinic.mutate()} disabled={clinic.isPending}>
              Init Clinic
            </Button>
            <Button variant="secondary" onClick={() => patient.mutate()} disabled={patient.isPending}>
              New Patient
            </Button>
            <Button variant="outline" onClick={() => void run('deploy', async () => api.deployJob())}>
              Queue Deploy
            </Button>
          </div>

          <Field
            label="Contract Address"
            value={contractAddress}
            onChange={setContractAddress}
            placeholder="0x..."
            mono
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void run('join', async () => api.join(contractAddress))}>
              Join Contract
            </Button>
            <Button variant="ghost" onClick={() => void run('state', async () => api.contractState())}>
              Read State
            </Button>
          </div>

          <ResultDisplay title="Last Operation" value={lastResult} />
        </CardContent>
      </Card>
    </section>
  );
};
