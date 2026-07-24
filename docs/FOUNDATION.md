# Foundation (clear & frozen)

> 底座简单稳定；业务扩展只动 modules。  
> **只有 `src/plugins/*` 叫「插件」（Fastify 官方）。业务不叫插件。**

## 两个词，不要混

| 词 | 是什么 | 目录 |
|---|---|---|
| **插件 Plugin** | Fastify HTTP 能力 | `src/plugins/*` + `@fastify/*` |
| **模块 Module** | 业务功能（路由+服务） | `src/modules/*` |

**什么时候做模块：** 有 API/页面的业务（dnspod、saas…）  
**什么时候做插件：** 只碰 HTTP 壳（安全、静态、session、错误处理）  
**禁止：** 再写 `modules/*/plugin.ts` / 自研 DI registry / Nest

## 目录

```text
src/
  app.ts              # Fastify 组装
  server.ts           # 进程入口 + ensureDataDirs
  app-context.ts      # 接线：new 服务 → ctx（只暴露控制器需要的）
  compose/
    http-modules.ts   # 路由表（追加一行）
  plugins/            # 唯一叫「插件」：官方 Fastify
  platform/           # job / events / ensure-data-dirs
  lib/
  modules/
    auth provider system
    dnspod cloudflare saas edgeone cloudflared
    sync              # 内部 DNS 同步（无 HTTP、不进 ctx）
    dns-batch         # DNS 批量（挂 dnspod/cf 路由）
  types/fastify.d.ts
  config/app.ts
```

## 请求路径

```text
Controller → request.server.ctx.<service>
Bulk       → JobService（batch service 构造时 registerRunner）
Side effect→ eventBus（真实在用的事件类型才保留）
API        → /api only
```

## 鉴权

- 公开：`GET /health`、`POST/GET/DELETE /session`
- 其余业务 API：统一走 compose 里一层 `authRequired`

## 加功能 3 步

1. `src/modules/<name>/`
2. `app-context.ts` new 服务并放进 return（仅控制器要用的）
3. `compose/http-modules.ts` 加一行

## 已删除（勿再引入）

- AppPlugin / ServiceRegistry / ServiceTokens / port adapters
- Usecase / Feature Flags / Backup API
- 未使用事件：`job.updated`、`saas.preferred_apply.finished`
- 把内部编排对象（如 SyncOrchestrator）挂到 ctx

## Boot

1. config + dataRoot  
2. ensureDataDirs（建 `saas/` `jobs/`，无 meta 版本）  
3. createAppContext（subscribers + services + resume jobs）  
4. buildApp（plugins + routes）  
5. listen  
