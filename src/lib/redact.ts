const SENSITIVE_PATTERNS = /secret|private|seed|password|token|mnemonic/i;

export const redactSensitiveFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((entry) => redactSensitiveFields(entry));
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_PATTERNS.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = redactSensitiveFields(nested);
  }
  return out;
};
