# DarkWallet Setup Guide

## Prerequisites

- Node.js 22+
- npm 10+
- Docker + Docker Compose
- A CIP-30 wallet extension for browser testing (Lace, Nami, Eternl, Vespr, Yoroi)

## 1. Clone and install

```bash
git clone https://github.com/akshaybapat6365/darkwallet.git
cd darkwallet
npm install
```

## 2. Start standalone infra

```bash
docker compose -f services/prover/standalone.yml up -d
```

Services started:
- Redis
- PostgreSQL
- Midnight proof server
- Midnight indexer
- Midnight node

## 3. Configure prover env

```bash
cp services/prover/.env.example services/prover/.env
```

Minimum local values:
- `MIDNIGHT_NETWORK=standalone`
- `MIDLIGHT_PROCESS_ROLE=all`
- optional API auth for local UI: `DARKWALLET_API_SECRET=<token>`

## 4. Run full local app

```bash
npm run dev:demo
```

Endpoints:
- Web: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:4000`

## 5. Quick verification flow

1. Open `/dev` and initialize clinic + join/deploy contract.
2. Open `/attestation` and complete challenge/sign/verify.
3. Open `/prescriptions` and create patient.
4. Register authorization and redeem pickup.
5. Open `/history` and confirm indexed records.

## 6. Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run test:sim
npm run test:e2e
npm run test:coverage:backend
npm run build
```
