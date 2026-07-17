# Architecture

**Foundation frozen** — see [FOUNDATION.md](./FOUNDATION.md).

## Tree (current)

```text
src/
  app.ts server.ts app-context.ts
  compose/http-modules.ts      # append-only route catalog
  kernel/                      # registry + contracts
  platform/                    # job, events, migration
  plugins/                     # official Fastify root plugins
  lib/                         # shared utils
  modules/
    auth/ provider/ system/
    dnspod/ cloudflare/ saas/ edgeone/ cloudflared/
    sync/                      # cross-provider DNS sync
    dns-batch/                 # shared DNS record batch jobs
  config/app.ts
```

## Extend

1. `modules/<name>/`
2. wire in `app-context.ts` if needed
3. one entry in `compose/http-modules.ts`
