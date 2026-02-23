# DarkWallet Architecture

## System Data Flow

```mermaid
flowchart LR
  UI[React App\nWalletProvider + ThemeProvider + Zustand]
  API[Fastify API\nAuth + Validation + Rate Limits]
  SSE[SSE Job Stream]
  Q[BullMQ Queue]
  W[Worker\nProof + Relay]
  DB[(PostgreSQL)]
  REDIS[(Redis)]
  MID[Midnight Network]
  CAR[Cardano + Blockfrost]

  UI -->|REST| API
  UI -->|SSE| SSE
  SSE --> API
  UI -->|CIP-30 signData| CAR
  API --> Q
  W --> Q
  API --> DB
  W --> DB
  API --> REDIS
  W --> REDIS
  API --> CAR
  W --> MID
```

## Frontend Composition

```mermaid
flowchart TD
  App[App.tsx Router]
  Shell[AppShell]
  Nav[NavBar + Theme Toggle + Mobile Tabs]
  Pages[Pages]
  Wallet[WalletProvider]
  Theme[ThemeProvider]
  Query[React Query]

  App --> Shell
  Shell --> Nav
  Shell --> Pages
  App --> Wallet
  App --> Theme
  App --> Query
```

## Contract State Machine (`pickup.compact`)

```mermaid
stateDiagram-v2
  [*] --> Registered: registerAuthorization
  Registered --> Redeemed: redeem (nullifier inserted)
  Registered --> Revoked: revokeAuthorization
  Registered --> Expired: expiresAt reached
  Redeemed --> [*]
  Revoked --> [*]
  Expired --> [*]
```

## Core Security Invariants

- No plaintext secrets on ledger state.
- Nullifier prevents redeem replay.
- Attestation hash binds Cardano ownership verification into intent flow.
- Intent nonce uniqueness prevents signature replay.
- API request auth + per-endpoint rate limiting protects relay resources.
