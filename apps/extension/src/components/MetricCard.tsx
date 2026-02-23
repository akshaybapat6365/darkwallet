import type { PropsWithChildren } from 'react';

type MetricCardProps = PropsWithChildren<{
  label: string;
  value: string;
}>;

export const MetricCard = ({ label, value, children }: MetricCardProps) => (
  <article className="dw-metric-card">
    <div className="dw-metric-label">{label}</div>
    <div className="dw-metric-value">{value}</div>
    {children ? <div className="dw-metric-foot">{children}</div> : null}
  </article>
);
