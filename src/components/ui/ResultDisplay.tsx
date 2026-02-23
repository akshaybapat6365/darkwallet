import { redactSensitiveFields } from '../../lib/redact';

export const ResultDisplay = ({ title, value }: { title: string; value: unknown }) => {
  if (!value) return null;
  const safeValue = redactSensitiveFields(value);
  return (
    <div className="rounded-md border border-border/70 bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <pre className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed">{JSON.stringify(safeValue, null, 2)}</pre>
    </div>
  );
};
