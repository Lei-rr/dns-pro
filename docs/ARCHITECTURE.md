# dns-pro Architecture (v1 progressive)

## Goals

- Modular monolith: single deployable, plugin-ready internals
- Versioned API only: `/api/v1`
- Forward-only data schema via `data/meta.json` + migrations
- Ports for Sync / Job so new providers and long tasks do not fork business code

## Layers

```text
web (Vue) → /api/v1 → modules (auth/provider/dns/saas/edge/tunnel/system)
                         ↓
                   contracts (ports)
                         ↓
              platform (registry/job/migration/cache/storage)
                         ↓
              provider adapters (dnspod/cloudflare/edgeone/…)
```

## API

All HTTP JSON APIs are under **`/api/v1` only**.  
There is no legacy `/api` mount.

Frontend axios `baseURL` is `/api/v1`.

## Plugins & registry

Boot path:

1. `runMigrations(dataDir)`
2. `createAppContext()` builds services
3. `ServiceRegistry.load([platformPlugin, syncPlugin, …])`
4. Fastify registers modules under `/api/v1`

Service tokens live in `src/contracts` (`ServiceTokens.*`).

## Data schema

- File: `data/meta.json` → `{ schema_version, updated_at }`
- Runner: `src/platform/migration.ts`
- Current version: **1** (ensures `saas/`, `backups/`, `jobs/` dirs)

Migrations only move forward. No downgrade path.

## Jobs

- Generic store: `src/platform/job/job-service.ts` → `data/jobs/jobs.json`
- Domain runner example: `saas.preferred_apply` registered by `SaasPreferredApplyService`
- Preferred-apply no longer uses a separate jobs file; API response shape stays stable via `present()`

## Sync

- All cross-provider DNS side effects should go through `SyncOrchestrator` / `SyncPort`
- SaaS + EdgeOne already do

## Next incremental steps

1. Split large services behind ports (`ZonePort` / `RecordPort` adapters)
2. Event bus for audit + cache invalidation
3. Extract `platform` as shared package for aws-pro
4. Generic frontend Job progress component
