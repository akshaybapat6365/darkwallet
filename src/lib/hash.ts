const encoder = new TextEncoder();

export const sha256Hex = async (input: string | Uint8Array): Promise<string> => {
  const bytes = typeof input === 'string' ? encoder.encode(input) : Uint8Array.from(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};
