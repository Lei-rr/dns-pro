# dns-pro Architecture (v1 progressive)

## Goals

- Modular monolith: single deployable, plugin-ready internals
- Versioned API only: `/api/v1`
- Forward-only data schema via `data/meta.json` + migrations
- Controllers → usecases → services/plugins

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
              provider plugins
```

## Usecase layer (current)

| Usecase | Covers |
|---|---|
| `DnsRecordMutationUseCase` | DNSPod/CF record create/update/delete |
| `DnsZoneMutationUseCase` | DNSPod/CF zone create/delete |
| `SaasHostnameMutationUseCase` | SaaS hostname create/update/delete/refresh |
| `ProviderMutationUseCase` | provider create/update/delete/sort |
| `EdgeOneDomainMutationUseCase` | EdgeOne domain create/update/delete/status/cert/sync |
| `TunnelMutationUseCase` | tunnel create/delete/token + route CRUD |

List/read paths continue via ports/registry.

## Plugins

platform / sync / dnspod / cloudflare / saas / edgeone / cloudflared

## Jobs

- `saas.preferred_apply`
- `saas.batch_delete` / `saas.batch_update`
- `dns.batch_delete`
- `edgeone.batch_disable` / `edgeone.batch_delete`

## Events

Major mutations emit domain events → audit + cache invalidation.

## Next

1. Optional feature flags for runners
2. Thin domain-event helpers shared by usecases
3. Later: extract platform package when aws-pro needs it
