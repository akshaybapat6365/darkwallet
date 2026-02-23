import React from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Button } from '../components/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { api } from '../lib/api';
import { truncate } from '../lib/utils';

const statusPill = (ok: boolean) =>
  ok
    ? 'inline-flex rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300'
    : 'inline-flex rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300';

const CountUp = ({ value }: { value: number }) => {
  const [display, setDisplay] = React.useState(value);
  const previousValueRef = React.useRef(value);

  React.useEffect(() => {
    const start = previousValueRef.current;
    const target = value;
    const durationMs = 500;
    const startedAt = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / durationMs, 1);
      const next = Math.round(start + (target - start) * progress);
      setDisplay(next);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      previousValueRef.current = target;
      cancelAnimationFrame(raf);
    };
  }, [value]);

  return <span>{display}</span>;
};

const DashboardSkeleton = () => (
  <section className="space-y-4 page-enter" aria-busy="true" aria-live="polite">
    <Card className="glass overflow-hidden">
      <CardHeader>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </CardContent>
    </Card>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-36 w-full" />
    </div>

    <Card className="glass">
      <CardHeader>
        <Skeleton className="h-6 w-40" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </CardContent>
    </Card>
  </section>
);

export const DashboardPage = () => {
  const health = useQuery({
    queryKey: ['health-dashboard'],
    queryFn: api.health,
    refetchInterval: 8_000,
  });

  const pickups = useQuery({
    queryKey: ['pickups-dashboard'],
    queryFn: () => api.pickups(5, 0),
    refetchInterval: 10_000,
  });

  if (health.isLoading || pickups.isLoading) {
    return <DashboardSkeleton />;
  }

  const patientCount = health.data?.patientCount ?? 0;
  const pickupCount = pickups.data?.pickups.length ?? 0;

  return (
    <section className="space-y-4 page-enter">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
        <Card className="glass overflow-hidden">
          <CardHeader>
            <CardTitle className="text-2xl">DarkWallet</CardTitle>
            <div className="text-sm text-muted-foreground">
              Shielded prescription verification and pickup workflows on Midnight.
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/prescriptions">Verify Prescription</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/history">View History</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/attestation">Run Attestation</Link>
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.03 }}>
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Network</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <div>{health.data?.network ?? 'unknown'}</div>
              <div className="mt-2">
                <motion.span
                  key={health.data?.ok ? 'healthy' : 'degraded'}
                  initial={{ opacity: 0.25, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.18 }}
                  className={statusPill(Boolean(health.data?.ok))}
                >
                  {health.data?.ok ? 'healthy' : 'degraded'}
                </motion.span>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Probes: redis {health.data?.probes?.redis.ok ? 'ok' : 'down'} • pg {health.data?.probes?.postgres.ok ? 'ok' : 'down'} • proof {health.data?.probes?.proofServer.ok ? 'ok' : 'down'}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.06 }}>
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Contract</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {health.data?.contractAddress ? (
                <div className="font-mono">{truncate(health.data.contractAddress, 32)}</div>
              ) : (
                <div className="text-muted-foreground">Not deployed/joined</div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.09 }}>
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>Patients: <CountUp value={patientCount} /></div>
              <div>Indexed Pickups: <CountUp value={pickupCount} /></div>
              <div>Intent Signing: {health.data?.features.enableIntentSigning ? 'on' : 'off'}</div>
              <div>Attestation Policy: {health.data?.features.enableAttestationEnforcement ? 'on' : 'off'}</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pickups.data?.pickups.length ? (
            pickups.data.pickups.map((entry) => (
              <motion.div
                key={entry.commitmentHex}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-md border border-border/60 bg-background/40 p-2 text-sm"
              >
                <div className="font-mono">{truncate(entry.commitmentHex, 30)}</div>
                <div className="text-xs text-muted-foreground">
                  rx {entry.rxId} • block {entry.registeredBlockHeight} • {entry.redeemedTxId ? 'redeemed' : 'active'}
                </div>
              </motion.div>
            ))
          ) : (
            <div className="text-sm text-muted-foreground">No indexed pickups yet.</div>
          )}
        </CardContent>
      </Card>
    </section>
  );
};
