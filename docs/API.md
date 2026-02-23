# DarkWallet API Reference

Base URL (local): `http://127.0.0.1:4000`

Authentication:
- `Authorization: Bearer <token>` for all endpoints except `GET /api/health`
- SSE supports `?token=<token>` query when headers are unavailable

## Health + Status

### `GET /api/health`
Returns process/network capability and contract status.

Response fields:
- `ok`
- `network`
- `processRole`
- `features.enableIntentSigning`
- `features.enableAttestationEnforcement`
- `features.allowLegacyJobEndpoints`
- `probes.redis.{ok,latencyMs,error?,mode}`
- `probes.postgres.{ok,latencyMs,error?,mode}`
- `probes.proofServer.{ok,latencyMs,error?,mode}`
- `contractAddress`
- `clinicInitialized`
- `patientCount`
- `privateStateStoreName`

## Clinic + Patient

### `POST /api/clinic/init`
Initializes issuer identity.

Response:
- `issuerPublicKeyHex`

### `POST /api/patient`
Creates a patient identity.

Response:
- `patientId`
- `patientPublicKeyHex`

### `POST /api/contract/join`
Join existing contract address.

Request:
- `contractAddress: string`

### `GET /api/contract/state`
Reads current ledger state snapshot.

### `POST /api/contract/deploy`
Synchronous deploy (dev/admin path).

### `POST /api/clinic/register`
Legacy direct register call (subject to feature flags).

### `POST /api/patient/redeem`
Legacy direct redeem call (subject to feature flags).

### `POST /api/clinic/revoke`
Revokes an authorization commitment.

Request body:
- `rxId`
- `pharmacyIdHex`
- `patientId` or `patientPublicKeyHex`
- `attestationHash?`
- `expiresAt?`

### `POST /api/clinic/register-batch`
Registers 1..8 authorization commitments in a single transaction.

Request body:
- `items: RegisterAuthorization[]` (min 1, max 8)

Each item:
- `rxId`
- `pharmacyIdHex`
- `patientId` or `patientPublicKeyHex`
- `attestationHash?`
- `expiresAt?`

Response:
- `count`
- `items[]`
- `txId`
- `blockHeight`
- `contractAddress`

### `POST /api/clinic/transfer-issuer`
Rotates issuer authority to a new issuer key.

Request body:
- `newIssuerSecretKeyHex?` (32-byte hex; if omitted, generated server-side)

Response:
- `issuerPublicKeyHex`
- `txId`
- `blockHeight`
- `contractAddress`

## Job Queue + Events

### `POST /api/jobs/deploy`
Enqueue deploy job.

### `POST /api/jobs/register`
Enqueue register authorization job.

### `POST /api/jobs/redeem`
Enqueue redeem job.

### `GET /api/jobs/:jobId`
Returns snapshot:
- `id`
- `type`
- `status`
- `stage`
- `progressPct`
- `logs[]`
- `result?`
- `error?`

### `GET /api/jobs/:jobId/events`
Server-Sent Events stream:
- `jobId`
- `stage`
- `progressPct`
- `message`
- `ts`

## Pickup Index

### `GET /api/pickups?limit=<n>&offset=<n>`
Returns indexed pickups.

Record fields:
- `contractAddress`
- `commitmentHex`
- `expiresAt`
- `nullifierHex`
- `revokedAt`
- `revokedTxId`
- `revokedBlockHeight`
- `rxId`
- `pharmacyIdHex`
- `patientPublicKeyHex`
- `registeredTxId`
- `registeredBlockHeight`
- `redeemedTxId`
- `redeemedBlockHeight`
- `updatedAt`

## Attestations (v1)

### `POST /api/v1/attestations/challenge`
Creates a challenge for CIP-30 signing.

Request:
- `assetFingerprint`
- `walletAddress?`
- `midnightAddress?`

Response:
- `challengeId`
- `nonce`
- `message`
- `typedPayload`
- `payloadHex`
- `expiresAt`

### `POST /api/v1/attestations/verify`
Verifies signed challenge and Blockfrost ownership.

Request:
- `challengeId`
- `walletAddress`
- `assetFingerprint`
- `midnightAddress?`
- `signedPayloadHex`
- `coseSign1Hex` (or `signatureHex`)
- `coseKeyHex` (or `keyHex`)

Response:
- `attestationHash`
- `verified`
- `source`
- `quantity`
- `walletAddress`
- `keyHashHex`
- `oracleEnvelope`
- `expiresAt`

### `GET /api/v1/attestations/:attestationHash`
Returns attestation record + validity windows.

## Intents (v1)

### `POST /api/v1/intents/prepare`
Creates canonical typed payload for self-custody signing.

Request:
- `action: registerAuthorization | redeem`
- `body` (action-specific payload)

Response:
- `intentId`
- `nonce`
- `issuedAt`
- `expiresAt`
- `typedPayload`
- `message`
- `payloadHex`
- `payloadHashHex`

### `POST /api/v1/intents/submit`
Verifies signature, enforces replay checks, leases gas slot, enqueues relay job.

Request:
- `intentId`
- `walletAddress`
- `signedPayloadHex`
- `coseSign1Hex` (or `signatureHex`)
- `coseKeyHex` (or `keyHex`)

Response:
- `intentId`
- `action`
- `walletAddress`
- `gasSlotId`
- `jobId`

## Versioned Aliases

Versioned paths are available for:
- `/api/v1/jobs/*`
- `/api/v1/pickups`
- `/api/v1/clinic/revoke`
- `/api/v1/clinic/register-batch`
- `/api/v1/clinic/transfer-issuer`

## Error Envelope

All errors follow:

```json
{
  "statusCode": 400,
  "message": "human-readable reason",
  "requestId": "req-123",
  "technical": "optional diagnostic detail"
}
```
