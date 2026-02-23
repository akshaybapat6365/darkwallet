# DarkWallet Deployment Runbook

## 1. Prepare host

- Ubuntu 22.04+
- Docker Engine + Compose plugin
- DNS pointed to host
- TLS certificates available (Let's Encrypt or equivalent)

## 2. Configure environment

```bash
cp .env.example .env
```

Required production values:
- `MIDNIGHT_NETWORK=preview|preprod|mainnet`
- `MIDNIGHT_WALLET_SEED`
- `DARKWALLET_API_SECRET` (or legacy alias)
- `DARKWALLET_ENCRYPTION_KEY` (32-byte hex)
- `DARKWALLET_ORACLE_PRIVATE_KEY`
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `SSL_CERT_BASE`
- `SSL_DOMAIN`

## 3. Start stack

```bash
docker compose -f docker-compose.production.yml up -d --build
```

Services:
- `darkwallet-prover`
- `darkwallet-postgres-prod`
- `darkwallet-redis-prod`
- `darkwallet-nginx`

## 4. Verify health

```bash
curl -sS https://<your-domain>/api/health | jq
```

Expected:
- `ok: true`
- `probes.redis.ok: true`
- `probes.postgres.ok: true`
- `probes.proofServer.ok: true`

## 5. Operational checks

- Check API logs (`docker logs darkwallet-prover`)
- Confirm request IDs are present in responses (`x-request-id`)
- Confirm attestation and intent flows from UI

## 6. Rollback

- Roll back to prior image tag in compose file
- `docker compose -f docker-compose.production.yml up -d`
- Re-run smoke checks
