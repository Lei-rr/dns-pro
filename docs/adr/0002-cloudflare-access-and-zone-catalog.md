# ADR-0002：Cloudflare 共享底座 CloudflareAccess 与 ZoneCatalog

- 状态：Accepted（已落地）
- 日期：2026-10-04
- 依据：`dns-pro-target-architecture.md` §3 D2；落地提交 `57719e3`
- 相关代码：`server/src/domains/cloudflare/access.ts`、`server/src/domains/cloudflare/zone-catalog.ts`

## 背景

Cloudflare 被拆成三条产品线（DNS / SaaS / 隧道），但两条共享能力没有归属：

- **账号解析**：provider → `account_id` → 客户端。SaaS 与隧道各写一份；隧道还要先做「隧道服务商 → 关联 Cloudflare 服务商」的转换，这段逻辑单独躺在 `tunnel-account.ts`。
- **站点目录**：FQDN → 所属 zone 的最长后缀匹配，以及证书委派 UUID 查询，能力散在 `cloudflare-zone.service.ts`（`bestMatchId`、`dcvDelegationUuid`），客户端构造还有 `cloudflareClientFor` 这类重复入口。

结果是同一语义存在多份实现：改一处（例如错误码或 account 校验）不会自动传导到另外两处。

## 决策

在 `domains/cloudflare/` 内建立两个 vendor 级底座，三条产品线只依赖底座、互不引用：

1. `access.ts` —— `CloudflareAccess`：`forProvider(id) → { provider, accountId, client }`、`linkedProviderId(id)`、`forTunnel(id) → TunnelAccount`。账号解析与错误码（`cloudflare_provider_not_found` / `cloudflared_provider_not_found` / `cloudflared_cloudflare_provider_missing` / `cloudflared_account_id_required`）只有一份。
2. `zone-catalog.ts` —— `ZoneCatalog`：`resolve(providerId, fqdn)` 做最长后缀匹配并返回 `ZoneRef`（含 DCV 委派 `dcvDelegationUuid`），匹配规则只有一份。

同步删除重复入口：`cloudflareClientFor`、`CloudflareZoneService.bestMatchId` / `dcvDelegationUuid`、`tunnel-account.ts`（`TunnelAccount` 类型迁到 `access.ts`）。

## 后果

正面：

- 账号解析、最长后缀匹配、DCV 查询各只有一处实现，改一处三条产品线同时受益。
- 产品线之间零 import，`cloudflare/saas` 改动不会隐式影响 `cloudflare/dns`。
- 底座可被单独构造与测试（依赖 `ProviderRepository` 与 zone service 两个显式入参）。

负面：

- `domains/cloudflare` 内多了一个共享层：底座的改动会同时影响三条产品线，回归必须覆盖隧道与 SaaS 探针（`probe:tunnel-route`、`probe:functional`）。
- 底座与 zone service 相互引用（`ZoneCatalog` 依赖 `CloudflareZoneService.listAll`），需要保持方向单一，避免下一步把 `access` 反向拖进 zone service。

## 替代方案

- **把底座放进 `kernel/`**：否决。`kernel` 禁止业务词与厂商名，且底座依赖 `ProviderRepository` 与 Cloudflare 客户端，属于厂商域。
- **允许产品线互相 import**：否决。已验证会产生"改一处炸三处"的隐性耦合，且与依赖规则冲突。
- **维持各写一份**：否决。账号解析与最长后缀匹配是安全与正确性敏感逻辑，多份实现即多处漏洞面。

## 验证

`npm run arch:final`（禁止跨产品线 import）、`npm run probe:tunnel-route`、`npm run probe:api`、`npm run probe:functional` 全绿。
