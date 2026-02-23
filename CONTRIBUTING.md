# Contributing to DarkWallet

## Branching

- Feature: `feat/<area>-<summary>`
- Fix: `fix/<area>-<summary>`
- Docs: `docs/<summary>`

## Pull Request Requirements

1. Clear problem statement and scope.
2. Linked issue or rationale.
3. Tests added/updated for behavior changes.
4. All quality gates pass locally.

## Required checks

```bash
npm run lint
npm run typecheck
npm test
npm run test:coverage:backend
npm run test:sim
npm run test:e2e
npm run build
```

## Coding standards

- TypeScript-first in frontend and backend.
- No secret material in UI/API responses.
- Prefer explicit schemas for API input/output.
- Preserve accessibility (`aria-label`, keyboard navigation, focus states).

## Security-sensitive changes

For auth, attestation, intent signing, cryptographic or key-management changes:
- include threat impact in PR description,
- include adversarial test case coverage,
- request a security-focused review.
