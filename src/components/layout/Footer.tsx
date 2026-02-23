import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';
import { truncate } from '../../lib/utils';

export const Footer = () => {
  const health = useQuery({
    queryKey: ['health-footer'],
    queryFn: api.health,
    refetchInterval: 10_000,
  });

  return (
    <footer className="mt-8 border-t border-border/60 bg-card/60">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-4 py-4 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
        <div>DarkWallet beta • Midnight {health.data?.network ?? 'unknown'}</div>
        <div className="font-mono">
          Contract: {health.data?.contractAddress ? truncate(health.data.contractAddress, 24) : 'not joined'}
        </div>
      </div>
    </footer>
  );
};
