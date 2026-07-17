# Foundation (FROZEN)

> 老大要求：底座简单、稳定、可靠；尽量用 Fastify 官方插件。  
> **后续功能扩展/修改只改 `modules/*`（和接线清单），不要再动本文件列出的底层。**

## What is foundation

| Path | Role | May change later? |
|---|---|---|
| `src/server.ts` | process entry, listen/shutdown | No |
| `src/app.ts` | Fastify shell: official plugins + `/api/v1` | No |
| `src/plugins/*` | Official `@fastify/*` + `fastify-plugin` only | Rare (security/static only) |
| `src/kernel/*` | Tiny registry + module list types | No (additive tokens only) |
| `src/platform/job` | Background jobs store | Rare |
| `src/platform/events` | In-process audit/cache side-effects | Rare |
| `src/platform/migration` | Forward-only data schema | Add migration versions only |
| `src/lib/*` | Shared utils (http/storage/cache/auth cookie) | Shared bugfix only |
| `src/compose/http-modules.ts` | **Append-only** route catalog | Yes — **add one line** for new module |
| `src/app-context.ts` | Wire services into registry/ctx | Yes — **wire only**, no business rules |

## Official Fastify only (HTTP shell)

```text
fastify
fastify-plugin          # ONLY for root plugins that must break encapsulation
@fastify/cookie
@fastify/helmet
@fastify/sensible
@fastify/static
@fastify/compress
```

Core patterns (not libraries):

- `app.register(..., { prefix })` for scopes
- `preHandler` for auth envelope
- `decorate` / `decorateRequest` via root `fp` plugins
- `requestIdHeader` / `genReqId`

**Not foundation:** Nest, Awilix, autoload, BullMQ, feature-flag frameworks, usecase frameworks.

## What is NOT foundation (change freely)

```text
src/modules/**     all product features (dnspod/cf/saas/edgeone/tunnel/…)
web/**             frontend
```

## How to add a feature (do not touch foundation)

1. Implement under `src/modules/<name>/`
2. If needs DI: construct + `registry` in `app-context.ts` (wire only)
3. Append one entry in `compose/http-modules.ts`
4. Controller → service (or `registry.require` for EdgeOne/Tunnel)
5. Long work → existing `JobService.registerRunner`
6. Side effects → existing `eventBus.emit` (or keep service-level emit)

## Boot order (do not reorder)

1. `loadAppConfig` + `setDataRoot`
2. `runMigrations`
3. `createAppContext` (services + plugins + resume jobs)
4. `buildApp` (Fastify official plugins + routes)
5. `listen` + graceful close

## Forbidden

- Rewriting architecture “for cleanliness”
- Dual `/api` + `/api/v1`
- Wrapping every route module in `fastify-plugin` (breaks encapsulation)
- Introducing a second DI / module framework
