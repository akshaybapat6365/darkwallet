# DarkWallet Security Model

## Scope

DarkWallet secures a privacy-preserving prescription flow across:
- Cardano L1 ownership attestations
- Midnight private state transitions
- Relayer-mediated transaction submission

## Threat Model Summary

Primary threats addressed:
- Replay of redeemed authorizations
- Replay of signed intents
- Forged L1 ownership claims
- Unauthorized API usage
- Secret exfiltration from local/DB stores
- Relayer UTxO contention and fee-drain attempts

Residual risks still requiring operational controls:
- Compromised browser extension wallet
- Host compromise where API runtime secrets are exposed
- Misconfigured TLS/reverse proxy in deployment

## Identity and Signing

### User self-custody
- Browser wallet signs challenge and intent payloads via CIP-30 `signData`.
- Backend validates signatures and never receives user private keys.

### Oracle attestation envelope
- Backend oracle signs canonical attestation payloads with Ed25519.
- Envelope includes `domainTag`, payload hash, public key, and signature.
- Contract/service logic binds authorization flow to this attestation hash.

### Intent replay protection
- Intent submit is two-phase (`prepare` -> `submit`).
- Nonce claims are unique per `(walletAddress, nonce, action, chainId)`.
- Replays return conflict errors.

## Contract-Level Safety

`pickup.compact` enforces:
- Commitment-only public state (no plaintext private payloads)
- Nullifier-based replay prevention on redeem
- Optional authorization expiry checks
- Authorization revocation set tracking

## API Security Controls

### Authentication
- Bearer token auth enabled via `MIDLIGHT_API_SECRET` / `DARKWALLET_API_SECRET`
- `GET /api/health` exempt
- SSE supports query token `?token=...`

### Input validation
- Zod schema validation for all typed routes
- Request IDs attached to error envelopes
- Auditable event records for challenge/verify/intent stages

### CORS and rate limiting
- CORS enabled (origin passthrough)
- Global + endpoint-specific rate limits configured in Fastify

## Secret Handling

### At rest
- File and PostgreSQL state stores support encryption at rest (`AES-256-GCM`)
- Encryption key from `MIDLIGHT_ENCRYPTION_KEY` / `DARKWALLET_ENCRYPTION_KEY`
- Plaintext store entries auto-migrate on read when encryption is enabled

### In API responses
- Secret key material is not returned to clients in clinic/patient setup responses
- Frontend result renderer redacts fields matching secret/private/token patterns

## Attestation Verification Pipeline

1. Challenge created with TTL and one-time lifecycle.
2. Wallet signs canonical payload.
3. Backend verifies CIP-30 signature structure and key hash linkage.
4. Backend checks Blockfrost ownership + minimum ADA threshold.
5. Oracle envelope issued; attestation record persisted with expiry.

Hardening:
- COSE payload size limits applied before CBOR decode.
- Expired or revoked attestations are rejected.

## Relayer and Queue Hardening

### BullMQ separation
- API process enqueues jobs and returns immediately.
- Worker process performs CPU-heavy proving and relay execution.

### Gas slot leasing
- Relayer gas slots are pre-bootstrapped and leased per intent.
- PostgreSQL backend uses row-level locking strategy.
- Slot is released on completion/failure timeout path.

## Deployment Requirements

For preview/preprod/mainnet:
- Use explicit oracle private key (`MIDLIGHT_ORACLE_PRIVATE_KEY` or alias)
- Use API secret and encryption key
- Configure TLS (`MIDLIGHT_TLS_CERT` + `MIDLIGHT_TLS_KEY`) or terminate TLS at reverse proxy
- Use persistent DB + Redis, not in-memory fallbacks

## Operational Checklist

- Rotate API secret and oracle keys regularly.
- Keep Blockfrost project key private and scoped.
- Enable centralized log shipping for audit records.
- Monitor:
  - attestation challenge->verify success rate
  - intent submit replay rejection count
  - relay latency p50/p95
  - failed job reasons
- Run full CI test matrix before release:
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`
  - `npm run test:sim`
  - `npm run test:e2e`
  - `npm run build`
