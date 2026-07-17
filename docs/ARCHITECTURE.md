# dns-pro Architecture (v1 progressive)

## Goals

- Modular monolith: single deployable, plugin-ready internals
- Versioned API only: `/api/v1`
- Forward-only data schema via `data/meta.json` + migrations
- Ports/plugins for Sync / Job / DNS / SaaS / EdgeOne / Tunnel

## Layers

```text
web (Vue) → /api/v1 → modules (auth/provider/dns/saas/edge/tunnel/system)
                         ↓
                   contracts (ports)
                         ↓
              platform (registry/job/migration/events/cache/storage)
                         ↓
              provider plugins (dnspod/cloudflare/saas/edgeone/cloudflared/sync)
```

## Boot path

1. `runMigrations(dataDir)`
2. `createAppContext()` builds concrete services
3. `ServiceRegistry.load([...plugins])`
4. Fastify mounts modules under `/api/v1`

## Plugins

| Plugin | Registers |
|---|---|
| platform | JobPort, Audit, Backup, EventBus + subscribers |
| sync | SyncPort |
| dnspod | ZonePort / RecordPort |
| cloudflare | ZonePort / RecordPort |
| saas | preferred-apply + batch-job |
| edgeone | zones / domains / workflow services |
| cloudflared | tunnels / routes services |

Port helpers: `src/platform/port-resolve.ts`

## Controllers resolution style

- DNS list: `resolveZonePort` / `resolveRecordPort`
- EdgeOne / Tunnel: `registry.require(ServiceTokens.*)`
- Mutations still use concrete domain services, but emit events

## Events

Bus: `src/platform/events/event-bus.ts`  
All mutation events auto-audit; cache events invalidate tags.

Publishers:

- DNSPod/Cloudflare record + zone mutations
- SaaS hostname + batch jobs
- Provider create/update/delete
- EdgeOne domain create/update/delete/status/certificate
- Tunnel create/delete/token + route create/update/delete

## Jobs

- Store: `data/jobs/jobs.json`
- Runners:
  - `saas.preferred_apply`
  - `saas.batch_delete`
  - `saas.batch_update`
  - `dns.batch_delete`

## Data schema

- `data/meta.json` schema_version **1**
- Forward-only migrations only

## Next incremental steps

1. Introduce thin usecase layer for mutations (create/update/delete)
2. EdgeOne batch jobs (disable/delete) on JobService
3. Feature flags for new runners
4. Later: extract `platform` package (when aws-pro needs it)
