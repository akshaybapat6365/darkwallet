import { cn } from '../../lib/utils';

type SkeletonProps = {
  className?: string;
};

export const Skeleton = ({ className }: SkeletonProps) => (
  <div
    className={cn(
      'animate-pulse rounded-md border border-border/40 bg-gradient-to-r from-muted/60 via-muted/30 to-muted/60',
      className,
    )}
    aria-hidden="true"
  />
);

