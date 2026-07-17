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

## Events

- Bus: `src/platform/events/event-bus.ts`
- Subscribers: audit log + cache tag invalidation
- Publishers today:
  - DNSPod/Cloudflare record create/update/delete
  - SaaS hostname create/update/delete

## Ports

- DNSPod/Cloudflare `ZonePort` / `RecordPort` adapters registered in `app-context`
- New code should prefer `registry.require(ServiceTokens.*Port)` over concrete services when practical

## Jobs

- Generic store: `src/platform/job/job-service.ts` → `data/jobs/jobs.json`
- Domain runner: `saas.preferred_apply`
- Frontend helper: `web/src/shared/composables/useJobProgress.ts`
- Alert component: `web/src/shared/components/JobProgressAlert.vue`

## Next incremental steps

1. Route more module mutations through EventBus (zone/provider/tunnel)
2. Consume Zone/Record ports from controllers/usecases
3. Extract `platform` package for aws-pro
4. Expand JobProgressAlert usage beyond preferred-apply
