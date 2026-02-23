export type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [k: string]: CanonicalValue };

export const canonicalize = (value: unknown): CanonicalValue => {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numeric value is not allowed in canonical payload');
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value === 'object') {
    const out: { [k: string]: CanonicalValue } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return String(value);
};

export const stableStringify = (value: unknown): string => JSON.stringify(canonicalize(value));
