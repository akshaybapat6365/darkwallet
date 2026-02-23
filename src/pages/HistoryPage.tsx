import { useQuery } from '@tanstack/react-query';

import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { api } from '../lib/api';
import { truncate } from '../lib/utils';

export const HistoryPage = () => {
  const history = useQuery({
    queryKey: ['pickups-history'],
    queryFn: () => api.pickups(200),
    refetchInterval: 10_000,
  });

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
                {(history.data?.pickups ?? []).map((item) => (
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
          {!history.data?.pickups.length ? (
            <div className="mt-4 text-sm text-muted-foreground">No prescriptions recorded yet.</div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
};
