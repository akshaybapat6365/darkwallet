import { RUNTIME_CONFIG } from '@ext/shared/config';

export class ExtensionApiError extends Error {
  status?: number;
  requestId?: string;
}

const withAuthHeader = (headers?: HeadersInit): Headers => {
  const merged = new Headers(headers);
  if (RUNTIME_CONFIG.apiSecret.trim()) {
    merged.set('authorization', `Bearer ${RUNTIME_CONFIG.apiSecret.trim()}`);
  }
  return merged;
};

export const extensionFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${RUNTIME_CONFIG.backendBaseUrl}${path}`, {
    ...init,
    headers: withAuthHeader(init?.headers),
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const error = new ExtensionApiError(
      typeof data === 'object' && data && 'message' in data
        ? String((data as Record<string, unknown>).message)
        : `HTTP ${response.status}`,
    );
    error.status = response.status;
    if (typeof data === 'object' && data && 'requestId' in data) {
      error.requestId = String((data as Record<string, unknown>).requestId);
    }
    throw error;
  }

  return data as T;
};
