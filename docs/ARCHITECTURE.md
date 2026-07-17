# dns-pro Architecture (v1 progressive)

## Goals

- Modular monolith: single deployable, plugin-ready internals
- Versioned API only: `/api/v1`
- Forward-only data schema via `data/meta.json` + migrations
- Controllers → usecases → services/plugins
- Feature flags for gradual rollout of long jobs

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
              platform (registry/job/migration/events/features/cache/storage)
                         ↓
              provider plugins
```

## Feature flags

- Service: `src/platform/features/feature-flags.ts`
- Load order: defaults < `data/feature-flags.json` < env
- Env:
  - `FEATURE_FLAGS=job_edgeone_batch=false,audit_verbose=true`
  - or `FEATURE_JOB_EDGEONE_BATCH=false`
- API:
  - `GET /api/v1/health` includes `features`
  - `GET /api/v1/features`
- JobService refuses create when matching flag is off (`feature_disabled`)

Default flags (all on):

- `job_saas_preferred_apply`
- `job_saas_batch`
- `job_dns_batch`
- `job_edgeone_batch`
- `audit_verbose`

## Usecase layer

| Usecase | Covers |
|---|---|
| `DnsRecordMutationUseCase` | DNSPod/CF record create/update/delete |
| `DnsZoneMutationUseCase` | DNSPod/CF zone create/delete |
| `SaasHostnameMutationUseCase` | SaaS hostname create/update/delete/refresh |
| `ProviderMutationUseCase` | provider create/update/delete/sort |
| `EdgeOneDomainMutationUseCase` | EdgeOne domain mutations |
| `TunnelMutationUseCase` | tunnel + route mutations |

Helper: `src/platform/usecase/run-mutation.ts` (emit success/failed events)

## Plugins

platform / sync / dnspod / cloudflare / saas / edgeone / cloudflared

## Jobs

- `saas.preferred_apply`
- `saas.batch_delete` / `saas.batch_update`
- `dns.batch_delete`
- `edgeone.batch_disable` / `edgeone.batch_delete`

## Events

Major mutations emit domain events → audit + cache invalidation.
Controllers should not double-write audit for paths already covered by events.

## Next

1. Optional UI surface for feature flags
2. More shared mutation helpers where services still emit directly
3. Later: extract platform package when aws-pro needs it
