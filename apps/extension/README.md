# DarkWallet Chrome Extension (MV3)

This workspace contains the extension-first wallet shell for DarkWallet.

## Local development

```bash
npm install
npm -w apps/extension run dev
```

Then open Chrome:
1. `chrome://extensions`
2. Enable `Developer mode`
3. `Load unpacked`
4. Select `apps/extension/dist`

For backend-connected flows (health, attestation, intents), run prover stack in parallel:

```bash
docker compose -f services/prover/standalone.yml up -d
npm run dev:demo
```

## Build

```bash
npm -w apps/extension run build
```

## Runtime model

- `src/background/service-worker.ts`: wallet session state, vault lifecycle, CIP-30 request handler.
- `src/content-scripts/injector.ts`: bridge between web page and extension runtime.
- `src/injected/provider.ts`: injects `window.cardano.darkwallet` provider.
- `src/popup/*`: compact wallet controls (unlock, balance, send, receive, approvals).
- `src/fullpage/*`: full dashboard surfaces for attestation/prescription/history.

## Security note

`signTx` and `submitTx` are intentionally blocked in this milestone until full transaction builder + relay integration is complete.
