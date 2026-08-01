# DNS-Pro Architecture Contract

This file is the authoritative architecture boundary for all agents working in this repository.
Do not redesign the project unless the user explicitly changes this contract.

## Final technology decision

- Backend: Fastify 5 + TypeBox, modular monolith.
- Frontend: Vue 3 + Tailwind + shadcn-vue, lightweight four-layer feature slicing.
- Do not migrate to NestJS or add a DI container/decorator framework.
- Fastify is the fixed HTTP framework. Framework migration requires a new user requirement that Fastify cannot reasonably support.

## Backend topology

```text
src/
  app.ts / server.ts
  bootstrap/       composition only
  plugins/         Fastify plugins only
  modules/         domain modules
  workflows/       business use cases spanning multiple modules
  platform/        small generic runtime facilities
  shared/          pure domain-neutral code
```

Dependency direction:

```text
app/bootstrap -> workflows -> modules -> platform/shared
app/bootstrap -> modules -> platform/shared
modules must not import workflows
```

Each domain module owns its `routes / handlers / schema / service / repository / client / types` files.
Do not move domain behavior into bootstrap, platform, shared, a global context, or a generic manager.

## Naming

- TypeScript files: kebab-case with a domain prefix.
- Vue components: PascalCase.vue.
- Types/classes: PascalCase; functions/variables: camelCase.
- Fixed terms: DnsPod, EdgeOne, Cloudflare, SaaS, Cloudflared.
- Suffix meanings are fixed:
  - `.routes.ts`: Fastify route registration
  - `.handlers.ts`: HTTP adaptation
  - `.schema.ts`: TypeBox schemas and inferred request types
  - `.service.ts`: module-local business use cases
  - `.repository.ts`: durable local state
  - `.client.ts`: third-party HTTP API
  - `.adapter.ts`: implementation of a business port
  - `.workflow.ts`: cross-module business use case
  - `.types.ts`: module-owned public domain types
- Do not add vague `utils/`, `manager`, or `gateway.ts` abstractions.

## Cache boundary

The cache implementation has exactly two production files:

```text
platform/cache/memory-cache.ts
platform/cache/provider-cache.ts
```

Do not recreate forwarding layers such as `globalCache -> CacheManager -> withProviderCache`.
Provider queries use process-memory cache; explicit refresh bypasses and replaces it; mutations invalidate exact keys/tags.

## Storage and jobs

- Deployment invariant: one DNS-Pro application process owns one data directory.
- Do not build distributed locks, leases, fencing, consensus, or multi-writer protocols inside this personal project.
- If multi-instance deployment becomes a real requirement, stop and propose a standard external database/queue/lock instead of extending custom JSON infrastructure.
- JsonStore provides simple in-process serialized, atomic file replacement.
- JobService provides only durable create/resume/retry/progress/terminal-state behavior for the single process.
- Provider-specific side-effect reconciliation belongs in its workflow, not in generic JobService.

## Frontend topology

```text
web/src/
  app/
  pages/
  features/
    providers/
    dns/
    saas/
    edge-one/
    tunnels/
  shared/
    api/
    lib/
    ui/
```

- Do not add `entities`, `widgets`, `processes`, or full FSD layers.
- Pages compose features; features own business API/model/UI; shared contains no business domain.
- Async scope protection must use one small shared generation helper; do not build per-dialog state machines.

## Complexity budget

Before adding any abstraction or infrastructure, all of the following rules apply:

1. It must solve a reproduced current P0/P1 or serve at least two real business modules.
2. Prefer a standard library or established focused open-source package over custom infrastructure.
3. A correctness fix must not introduce more architectural layers than it removes.
4. More than 100 net new non-business LOC, a new platform subsystem, or a new cross-module dependency requires explicit user approval first.
5. Personal-project constraints outrank theoretical multi-process/distributed scenarios.
6. Audit findings outside the user-approved scope are reported as a list, not automatically implemented.
7. Verification code must remain smaller and simpler than the production capability it protects.
8. Once the architecture contract is satisfied, prioritize business features over further foundation work.

## Change discipline

- Before architecture work, state the final target and compare it with this file.
- Do not offer a different architecture in later sessions unless a new requirement invalidates this contract.
- Refactors preserve external API paths and business behavior unless the user explicitly requests a breaking change.
- No compatibility layers or parallel old/new architectures: make one atomic cut and delete the old path.
- Required final gates: format, lint, server/web typecheck, architecture dependency check, build, isolated API/static probes, and real UI interaction for changed UI.
