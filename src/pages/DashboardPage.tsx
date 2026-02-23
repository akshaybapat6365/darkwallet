import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Button } from '../components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { api } from '../lib/api';
import { truncate } from '../lib/utils';

const statusPill = (ok: boolean) =>
  ok
    ? 'inline-flex rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300'
    : 'inline-flex rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300';

export const DashboardPage = () => {
  const health = useQuery({
    queryKey: ['health-dashboard'],
    queryFn: api.health,
    refetchInterval: 8_000,
  });

  const pickups = useQuery({
    queryKey: ['pickups-dashboard'],
    queryFn: () => api.pickups(5),
    refetchInterval: 10_000,
  });

  return (
    <section className="space-y-4 page-enter">
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">Network</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div>{health.data?.network ?? 'unknown'}</div>
            <div className="mt-2">
              <span className={statusPill(Boolean(health.data?.ok))}>{health.data?.ok ? 'healthy' : 'degraded'}</span>
            </div>
          </CardContent>
        </Card>

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

        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">Features</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>Intent Signing: {health.data?.features.enableIntentSigning ? 'on' : 'off'}</div>
            <div>Attestation Policy: {health.data?.features.enableAttestationEnforcement ? 'on' : 'off'}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pickups.data?.pickups.length ? (
            pickups.data.pickups.map((entry) => (
              <div key={entry.commitmentHex} className="rounded-md border border-border/60 bg-background/40 p-2 text-sm">
                <div className="font-mono">{truncate(entry.commitmentHex, 30)}</div>
                <div className="text-xs text-muted-foreground">
                  rx {entry.rxId} • block {entry.registeredBlockHeight} • {entry.redeemedTxId ? 'redeemed' : 'active'}
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-muted-foreground">No indexed pickups yet.</div>
          )}
        </CardContent>
      </Card>
    </section>
  );
};
