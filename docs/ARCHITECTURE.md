# dns-pro Architecture (v1 progressive)

## Goals

- Modular monolith: single deployable, plugin-ready internals
- Versioned API only: `/api/v1`
- Forward-only data schema via `data/meta.json` + migrations
- Ports for Sync / Job / Zone / Record so providers stay swappable

## Layers

```text
web (Vue) → /api/v1 → modules (auth/provider/dns/saas/edge/tunnel/system)
                         ↓
                   contracts (ports)
                         ↓
              platform (registry/job/migration/events/cache/storage)
                         ↓
              provider plugins (dnspod/cloudflare/saas/sync)
```

## Boot path

1. `runMigrations(dataDir)`
2. `createAppContext()` builds concrete services
3. `ServiceRegistry.load([platform, sync, dnspod, cloudflare, saas])`
4. Fastify mounts modules under `/api/v1`

## Plugins

| Plugin | Registers |
|---|---|
| platform | JobPort, Audit, Backup, EventBus + subscribers |
| sync | SyncPort |
| dnspod | ZonePort / RecordPort adapters |
| cloudflare | ZonePort / RecordPort adapters |
| saas | preferred-apply + batch-job runners |

Port helpers: `src/platform/port-resolve.ts`

## API

All HTTP JSON APIs are under **`/api/v1` only**.  
Frontend axios `baseURL` is `/api/v1`.

### Read paths via ports (already)

- DNSPod zone/record list controllers → `resolveZonePort` / `resolveRecordPort`
- Cloudflare zone/record list controllers → same

Mutations still call concrete services, but emit domain events.

## Events

- Bus: `src/platform/events/event-bus.ts`
- Subscribers: audit log + cache tag invalidation
- Publishers:
  - DNSPod/Cloudflare record create/update/delete
  - DNSPod/Cloudflare zone create/delete
  - SaaS hostname create/update/delete + batch jobs
  - Provider create/update/delete

## Jobs

- Store: `data/jobs/jobs.json` via `JobService`
- Runners:
  - `saas.preferred_apply`
  - `saas.batch_delete`
  - `saas.batch_update`
  - `dns.batch_delete`
- Frontend: `useJobProgress` + optional `JobProgressAlert`

## Data schema

- `data/meta.json` → `{ schema_version, updated_at }`
- Current version: **1**
- Forward-only migrations in `src/platform/migration.ts`

## Next incremental steps

1. EdgeOne / Tunnel plugins + event publishers
2. Move remaining controllers fully off concrete services (mutations via ports/usecases)
3. Extract `platform` package for aws-pro
4. Optional feature flags for new runners
