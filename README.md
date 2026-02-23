# Midlight

Privacy-preserving prescription pickup demo using **Midnight Compact** contracts and **real ZK proofs** (via the Midnight proof server).

Use-case (demo):
1. A clinic registers an authorization for `(rxId, pharmacyId, patientPublicKey)` on-chain.
2. A patient redeems without revealing identity: they prove they control the patient secret key corresponding to the public key committed into the authorization.
3. A nullifier prevents double redemption.

This is intentionally a hackable reference implementation, not production logic.

## Repo Layout

- `midnight/contract/` Compact smart contract + generated ZK assets (generated into `src/managed/**`).
- `services/prover/` Node.js service that builds/signs/submits Midnight transactions and talks to the proof server.
- `/src/` Vite + React UI that calls the prover service.

## Prerequisites

- Node.js `>=22`
- Docker + Docker Compose
- `npm`

## Quickstart (Local Standalone Network)

1. Install deps:

```bash
npm install
```

2. Start local infrastructure (Midnight node + indexer + proof server + Redis + PostgreSQL):

```bash
docker compose -f services/prover/standalone.yml up -d
```

3. Start the demo (compiles the contract + starts prover + starts web):

```bash
export MIDLIGHT_REDIS_URL=redis://127.0.0.1:6379
export MIDLIGHT_DATABASE_URL=postgres://midlight:midlight@127.0.0.1:5432/midlight
# Optional in standalone; required outside standalone
export MIDLIGHT_API_SECRET=change-me
export MIDLIGHT_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
npm run dev:demo
```

Open the UI at `http://127.0.0.1:3000`.

Notes:
- ZK proof generation can take a long time on laptops. The UI uses background jobs (`BullMQ`) and streams stage updates using Server-Sent Events (`/api/jobs/:id/events`).
- Redis is a hard runtime dependency for the BullMQ queue (`MIDLIGHT_REDIS_URL`).
- If you see `Failed to connect to Proof Server: Transport error`, bump timeouts (see below).

## What’s “Real” Here

- Proof generation is done by the **Midnight proof server** (no deterministic/stub proofs).
- Transactions are created, balanced, signed, and submitted using the Midnight wallet SDKs.

## Local State

The prover service persists demo state in PostgreSQL when `MIDLIGHT_DATABASE_URL` is set.
If not set, it falls back to local file storage.

- `services/prover/.data/state.json` contains the deployed contract address and demo secrets.
- `services/prover/midlight-private-state*` is the LevelDB-backed private state store used by midnight-js.

These paths are gitignored.

## Configuration

Prover service env vars:

- `MIDLIGHT_HTTP_TIMEOUT_MS` (default: 1 hour)
- `MIDLIGHT_REDIS_URL` (default: `redis://127.0.0.1:6379`)
- `MIDLIGHT_DATABASE_URL` (optional, enables persistent pickup/job index in PostgreSQL)
- `MIDLIGHT_API_SECRET` (optional in standalone, required for non-standalone deployments)
- `MIDLIGHT_ENCRYPTION_KEY` (optional in standalone, required for non-standalone deployments; 32-byte hex key for secret encryption at rest)
- `MIDLIGHT_ORACLE_PRIVATE_KEY` (required for non-standalone deployments)
  - Used to increase the underlying Node fetch/undici timeouts for long-running `/prove` requests.
  - Example:

```bash
MIDLIGHT_HTTP_TIMEOUT_MS=$((2*60*60*1000)) npm -w services/prover run dev
```

Docker proof-server tuning (edit `services/prover/standalone.yml`, then recreate just the proof-server):

```bash
docker compose -f services/prover/standalone.yml up -d --force-recreate --no-deps proof-server
```

## Realtime Job API

- `POST /api/jobs/deploy`
- `POST /api/jobs/register`
- `POST /api/jobs/redeem`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/events` (SSE stream for stage transitions)
- `GET /api/pickups` (PostgreSQL-backed pickup index)

Versioned aliases:

- `POST /api/v1/jobs/deploy`
- `POST /api/v1/jobs/register`
- `POST /api/v1/jobs/redeem`
- `GET /api/v1/jobs/:jobId`
- `GET /api/v1/jobs/:jobId/events`
- `GET /api/v1/pickups`

Attestation scaffolding:

- `POST /api/attestations/challenge`
- `POST /api/attestations/verify`

## Environment Template

Use `services/prover/.env.example` as the baseline for local and deployment configuration.

## E2E Tests

Run Playwright end-to-end tests:

```bash
npm run test:e2e
```
