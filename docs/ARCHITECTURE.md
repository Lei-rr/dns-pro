# dns-pro Architecture (v1 progressive)

## Goals

- Modular monolith: single deployable, plugin-ready internals
- Versioned API only: `/api/v1`
- Forward-only data schema via `data/meta.json` + migrations
- Ports/plugins/usecases for Sync / Job / DNS / SaaS / EdgeOne / Tunnel

## Layers

```text
web (Vue) → /api/v1 → controllers
                         ↓
                   usecases (mutation entry)
                         ↓
                   modules / workflows / services
                         ↓
                   contracts (ports)
                         ↓
              platform (registry/job/migration/events/cache/storage)
                         ↓
              provider plugins (dnspod/cloudflare/saas/edgeone/cloudflared/sync)
```

## Boot path

1. `runMigrations(dataDir)`
2. `createAppContext()` builds concrete services + usecases
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
| edgeone | zones / domains / workflow / batch-job |
| cloudflared | tunnels / routes |

## Usecase layer (started)

- `DnsRecordMutationUseCase` — DNSPod/CF record create/update/delete
- `SaasHostnameMutationUseCase` — SaaS hostname create/update/delete/refresh

Controllers should call usecases for mutations; list reads continue via ports/registry.

## Jobs

Store: `data/jobs/jobs.json`

Runners:

- `saas.preferred_apply`
- `saas.batch_delete`
- `saas.batch_update`
- `dns.batch_delete`
- `edgeone.batch_disable`
- `edgeone.batch_delete`

## Events

All major mutations emit domain events → audit + optional cache invalidation.

## Next incremental steps

1. Expand usecases to zone/provider/edge/tunnel mutations
2. Optional feature flags for runners
3. Later: extract `platform` package (when aws-pro needs it)
