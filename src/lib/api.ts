export type JobStage =
  | 'QUEUED'
  | 'PROOF_COMPUTING'
  | 'TX_BUILDING'
  | 'AWAITING_SIGNATURE'
  | 'RELAYING'
  | 'CONFIRMED'
  | 'FAILED';

export type JobStatus = 'running' | 'succeeded' | 'failed';

export type JobSnapshot = {
  id: string;
  type: 'deployContract' | 'registerAuthorization' | 'redeem';
  status: JobStatus;
  stage: JobStage;
  progressPct: number;
  createdAt: string;
  updatedAt: string;
  logs: string[];
  result?: unknown;
  error?: { message: string };
};

export type JobEvent = {
  jobId: string;
  stage: JobStage;
  progressPct: number;
  message: string;
  ts: string;
};

export type HealthResponse = {
  ok: boolean;
  network: string;
  processRole?: 'all' | 'api' | 'worker';
  probes?: {
    redis: { ok: boolean; latencyMs: number; error?: string; mode?: 'enabled' | 'disabled' };
    postgres: { ok: boolean; latencyMs: number; error?: string; mode?: 'enabled' | 'disabled' };
    proofServer: { ok: boolean; latencyMs: number; error?: string; mode?: 'enabled' | 'disabled' };
  };
  features: {
    enableIntentSigning: boolean;
    enableAttestationEnforcement: boolean;
    allowLegacyJobEndpoints: boolean;
  };
  contractAddress: string | null;
  clinicInitialized: boolean;
  patientCount: number;
  privateStateStoreName: string;
};

export type PickupIndexRecord = {
  contractAddress: string;
  commitmentHex: string;
  expiresAt: string;
  nullifierHex: string | null;
  revokedAt: string | null;
  revokedTxId: string | null;
  revokedBlockHeight: number | null;
  rxId: string;
  pharmacyIdHex: string;
  patientPublicKeyHex: string;
  registeredTxId: string;
  registeredBlockHeight: number;
  redeemedTxId: string | null;
  redeemedBlockHeight: number | null;
  updatedAt: string;
};

export type PatientRecord = {
  patientId: string;
  patientPublicKeyHex: string;
};

export type RegisterAuthorizationBody = {
  rxId: string | number;
  pharmacyIdHex: string;
  patientId?: string;
  patientPublicKeyHex?: string;
  attestationHash?: string;
  expiresAt?: string | number;
};

export type RegisterBatchResponse = {
  count: number;
  items: Array<{
    commitmentHex: string;
    attestationHashHex: string;
    expiresAt: string;
    rxId: string;
    pharmacyIdHex: string;
    patientPublicKeyHex: string;
  }>;
  txId: string;
  blockHeight: number;
  contractAddress: string;
};

export type TransferIssuerResponse = {
  issuerPublicKeyHex: string;
  txId: string;
  blockHeight: number;
  contractAddress: string;
};

type RequestInit = {
  method?: 'GET' | 'POST';
  body?: unknown;
};

export class ApiError extends Error {
  status?: number;
  data?: unknown;
  requestId?: string;
}

const getApiToken = (): string | null => {
  const fromStorage = localStorage.getItem('darkwallet.apiToken');
  if (fromStorage && fromStorage.trim().length > 0) return fromStorage.trim();

  const fromDarkwalletEnv = import.meta.env.VITE_DARKWALLET_API_SECRET;
  if (typeof fromDarkwalletEnv === 'string' && fromDarkwalletEnv.trim().length > 0) return fromDarkwalletEnv.trim();

  const fromLegacyEnv = import.meta.env.VITE_MIDLIGHT_API_SECRET;
  if (typeof fromLegacyEnv === 'string' && fromLegacyEnv.trim().length > 0) return fromLegacyEnv.trim();
  return null;
};

const getAuthHeaders = (): Record<string, string> => {
  const token = getApiToken();
  return token ? { authorization: `Bearer ${token}` } : {};
};

const request = async <T>(path: string, { method = 'GET', body }: RequestInit = {}): Promise<T> => {
  const timeoutMs = 60_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...getAuthHeaders(),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const message =
        typeof data === 'object' && data && 'message' in data ? String((data as any).message) : `${res.status} ${res.statusText}`;
      const err = new ApiError(message);
      err.status = res.status;
      err.data = data;
      if (typeof data === 'object' && data && 'requestId' in data) {
        err.requestId = String((data as any).requestId);
      }
      throw err;
    }
    return data as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      const timeoutError = new ApiError(`Request timed out after ${timeoutMs / 1000}s`);
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
};

export type AttestationChallengeRequest = {
  assetFingerprint: string;
  walletAddress?: string;
  midnightAddress?: string;
};

export type AttestationChallengeResponse = {
  challengeId: string;
  nonce: string;
  message: string;
  typedPayload: Record<string, unknown>;
  payloadHex: string;
  expiresAt: string;
};

export type AttestationVerifyRequest = {
  challengeId: string;
  walletAddress: string;
  assetFingerprint: string;
  midnightAddress?: string;
  signedPayloadHex: string;
  coseSign1Hex: string;
  coseKeyHex: string;
};

export type OracleAttestationEnvelope = {
  algorithm: 'ed25519';
  domainTag: string;
  payload: {
    cardanoAddress: string;
    assetFingerprint: string;
    midnightAddress: string | null;
    challengeId: string;
    nonce: string;
    verifiedAt: string;
  };
  payloadHashHex: string;
  publicKeyHex: string;
  signatureHex: string;
};

export type AttestationVerifyResponse = {
  attestationHash: string;
  verified: true;
  source: 'blockfrost';
  quantity: string;
  walletAddress: string;
  keyHashHex: string;
  oracleEnvelope: OracleAttestationEnvelope;
  expiresAt: string;
};

export type AttestationRecord = {
  attestationHash: string;
  challengeId: string;
  walletAddress: string;
  assetFingerprint: string;
  verificationSource: 'blockfrost';
  midnightAddress: string | null;
  oracleEnvelope: OracleAttestationEnvelope;
  verifiedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type IntentAction = 'registerAuthorization' | 'redeem';

export type IntentPrepareRequest =
  | {
    action: 'registerAuthorization';
    body: RegisterAuthorizationBody;
  }
  | {
    action: 'redeem';
    body: {
      patientId: string;
      rxId: string | number;
      pharmacyIdHex: string;
      attestationHash?: string;
      expiresAt?: string | number;
    };
  };

export type IntentPrepareResponse = {
  intentId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  typedPayload: Record<string, unknown>;
  message: string;
  payloadHex: string;
  payloadHashHex: string;
};

export type IntentSubmitRequest = {
  intentId: string;
  walletAddress: string;
  signedPayloadHex: string;
  coseSign1Hex: string;
  coseKeyHex: string;
};

export type IntentSubmitResponse = {
  intentId: string;
  action: IntentAction;
  walletAddress: string;
  gasSlotId?: string | null;
  jobId: string;
};

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  clinicInit: () => request<{ issuerPublicKeyHex: string }>('/api/clinic/init', { method: 'POST' }),
  patientCreate: () => request<PatientRecord>('/api/patient', { method: 'POST' }),
  deployJob: () => request<{ jobId: string }>('/api/jobs/deploy', { method: 'POST' }),
  join: (contractAddress: string) => request<{ contractAddress: string }>('/api/contract/join', { method: 'POST', body: { contractAddress } }),
  contractState: () => request<{ ledgerState: unknown }>('/api/contract/state'),
  registerAuthorizationJob: (body: RegisterAuthorizationBody) => request<{ jobId: string }>('/api/jobs/register', { method: 'POST', body }),
  clinicRegisterBatch: (items: RegisterAuthorizationBody[]) =>
    request<RegisterBatchResponse>('/api/v1/clinic/register-batch', { method: 'POST', body: { items } }),
  clinicTransferIssuer: (body?: { newIssuerSecretKeyHex?: string }) =>
    request<TransferIssuerResponse>('/api/v1/clinic/transfer-issuer', { method: 'POST', body: body ?? {} }),
  redeemJob: (body: { patientId: string; rxId: string | number; pharmacyIdHex: string; attestationHash?: string; expiresAt?: string | number }) =>
    request<{ jobId: string }>('/api/jobs/redeem', { method: 'POST', body }),
  clinicRevoke: (body: {
    rxId: string | number;
    pharmacyIdHex: string;
    patientId?: string;
    patientPublicKeyHex?: string;
    attestationHash?: string;
    expiresAt?: string | number;
  }) => request('/api/v1/clinic/revoke', { method: 'POST', body }),
  pharmacyCheck: (body: { patientId: string; rxId: string | number; pharmacyIdHex: string; attestationHash?: string; expiresAt?: string | number }) =>
    request<{
      commitmentHex: string;
      nullifierHex: string;
      attestationHashHex?: string;
      expiresAt?: string;
      authorizationFound: boolean;
      revoked: boolean;
      redeemed: boolean;
      expiredByClientClock?: boolean;
      issuerPublicKeyHex: string | null;
    }>('/api/pharmacy/check', { method: 'POST', body }),
  job: (jobId: string) => request<{ job: JobSnapshot | null }>(`/api/jobs/${jobId}`),
  pickups: (limit = 100, offset = 0) =>
    request<{ pickups: PickupIndexRecord[] }>(
      `/api/pickups?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`,
    ),
  attestationChallenge: (body: AttestationChallengeRequest) =>
    request<AttestationChallengeResponse>('/api/v1/attestations/challenge', { method: 'POST', body }),
  attestationVerify: (body: AttestationVerifyRequest) =>
    request<AttestationVerifyResponse>('/api/v1/attestations/verify', { method: 'POST', body }),
  attestationGet: (attestationHash: string) =>
    request<{ attestation: AttestationRecord }>(`/api/v1/attestations/${encodeURIComponent(attestationHash)}`),
  intentPrepare: (body: IntentPrepareRequest) =>
    request<IntentPrepareResponse>('/api/v1/intents/prepare', { method: 'POST', body }),
  intentSubmit: (body: IntentSubmitRequest) =>
    request<IntentSubmitResponse>('/api/v1/intents/submit', { method: 'POST', body }),
};

export const streamJobEvents = (jobId: string, onMessage: (event: JobEvent) => void): (() => void) => {
  const token = getApiToken();
  const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
  const source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events${tokenParam}`);
  source.onmessage = (event) => {
    const parsed = JSON.parse(event.data) as JobEvent;
    onMessage(parsed);
  };
  source.onerror = () => {
    source.close();
  };
  return () => source.close();
};
