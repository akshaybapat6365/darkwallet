# Changelog

## Unreleased

### Added
- Theme provider with dark/light/system handling and navbar theme toggle.
- Skeleton loading states for dashboard, history, wallet, dev and prescription flows.
- Mobile navigation drawer + bottom tab navigation.
- Deep health probes (`redis`, `postgres`, `proofServer`) in `/api/health`.
- Structured logger module (`services/prover/src/logger.ts`).
- Backend tests for config alias behavior and utility canonical/hex edge cases.
- Documentation set: `docs/SETUP.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `CONTRIBUTING.md`.

### Changed
- `/api/pickups` and `/api/v1/pickups` now support `offset` pagination.
- History page now loads 20 records per page with `Load More`.
- Dashboard now includes animated status cards and activity metrics.
- Attestation page now shows live TTL countdown and expiry prompts.
- API now sets `x-request-id` response header globally.
- Route-specific rate limits hardened for health/challenge/intent submit endpoints.
- CI backend coverage threshold increased to 85%.

### Security
- Replaced ad-hoc startup logging with structured JSON logs in core server runtime.
- Added temporary audit allowlist governance note tied to SDK v5 migration review.
