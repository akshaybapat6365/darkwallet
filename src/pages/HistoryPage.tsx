import React from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '../components/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { api, type PickupIndexRecord } from '../lib/api';
import { truncate } from '../lib/utils';

const PAGE_SIZE = 20;

const mergeByCommitment = (prev: PickupIndexRecord[], next: PickupIndexRecord[]) => {
  const seen = new Set<string>();
  const out: PickupIndexRecord[] = [];
  for (const row of [...prev, ...next]) {
    if (seen.has(row.commitmentHex)) continue;
    seen.add(row.commitmentHex);
    out.push(row);
  }
  return out;
};

const HistorySkeleton = () => (
  <section className="space-y-4 page-enter" aria-busy="true" aria-live="polite">
    <Card className="glass">
      <CardHeader>
        <Skeleton className="h-7 w-56" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  </section>
);

export const HistoryPage = () => {
  const [offset, setOffset] = React.useState(0);
  const [rows, setRows] = React.useState<PickupIndexRecord[]>([]);
  const [hasMore, setHasMore] = React.useState(true);

  const history = useQuery({
    queryKey: ['pickups-history', offset],
    queryFn: () => api.pickups(PAGE_SIZE, offset),
    refetchInterval: offset === 0 ? 10_000 : false,
  });

  React.useEffect(() => {
    if (!history.data) return;
    const next = history.data.pickups;
    setRows((prev) => (offset === 0 ? next : mergeByCommitment(prev, next)));
    setHasMore(next.length === PAGE_SIZE);
  }, [history.data, offset]);

  if (history.isLoading && offset === 0 && rows.length === 0) {
    return <HistorySkeleton />;
  }

  return (
    <section className="space-y-4 page-enter">
      <Card className="glass">
        <CardHeader>
          <CardTitle>Indexed Pickup History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="py-2 pr-3">Rx</th>
                  <th className="py-2 pr-3">Pharmacy</th>
                  <th className="py-2 pr-3">Commitment</th>
                  <th className="py-2 pr-3">Nullifier</th>
                  <th className="py-2 pr-3">Block</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.commitmentHex} className="border-b border-border/40">
                    <td className="py-2 pr-3">{item.rxId}</td>
                    <td className="py-2 pr-3 font-mono">{truncate(item.pharmacyIdHex, 16)}</td>
                    <td className="py-2 pr-3 font-mono">{truncate(item.commitmentHex, 18)}</td>
                    <td className="py-2 pr-3 font-mono">{item.nullifierHex ? truncate(item.nullifierHex, 18) : '—'}</td>
                    <td className="py-2 pr-3">{item.registeredBlockHeight}</td>
                    <td className="py-2 pr-3">
                      <span className={item.redeemedTxId ? 'badge-success px-2 py-1 text-xs' : 'badge-warning px-2 py-1 text-xs'}>
                        {item.redeemedTxId ? 'redeemed' : 'active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!rows.length ? (
            <div className="mt-4 text-sm text-muted-foreground">No prescriptions recorded yet.</div>
          ) : (
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">Showing {rows.length} records</div>
              <Button
                variant="outline"
                onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
                disabled={!hasMore || history.isFetching}
              >
                {history.isFetching ? 'Loading…' : hasMore ? 'Load More' : 'No More Records'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
};
