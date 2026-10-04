# ADR-0003：统一写流水线 SyncPlan + DnsWriter

- 状态：Accepted（实现进行中，尚未落地）
- 日期：2026-10-04
- 依据：`dns-pro-target-architecture.md` §3 D3
- 相关代码（现状）：`server/use-cases/saas-dns-sync/cloudflare-dns-saas-sync.adapter.ts`、`server/use-cases/saas-dns-sync/dns-pod-saas-sync.adapter.ts`、`server/modules/cloudflare/tunnel/tunnel-dns.service.ts`

## 背景

DNS 记录是 SaaS 主机名、隧道路由、EdgeOne 加速域名的**派生投影**，但这件事没有自己的模型，以副作用形式散落：

- SaaS 侧由两个适配器各自构造记录（Cloudflare / DNSPod），期望态构造逻辑重复。
- 隧道有独立写路径（`tunnel-dns.service.ts`），与 SaaS 路径平行。
- 同一条 CNAME 的策略在两处不一致（proxied 取值、TTL 规则各写各的）。
- "期望态 vs 现状 → 要做什么"的对比逻辑没有单一实现，无法脱离 IO 单测。

## 决策

把"同步"从副作用升级为一等公民，写路径收敛为两段：

```ts
// 纯函数：期望态 vs 现状 → 计划（无 IO，可单测）
function planSync(target: SyncTarget, current: DnsRecord[], desired: DnsRecord[]): SyncPlan
// SyncPlan = { create: DnsRecord[]; update: { id: string; patch: Partial<DnsRecord> }[]; delete: string[] }

// 唯一写入端点：所有权校验 + 执行计划
class DnsWriter { apply(zone: ZoneRef, plan: SyncPlan, opts: { owner: Owner }): Promise<WriteResult> }
```

- 三条产品线（SaaS / 隧道 / EdgeOne）共用同一 writer，**不再各自构造写入**。
- proxied / ttl / 备注等策略由产品声明（planner 产出 `desired`），writer 不做业务判断。
- 检测（只读扫描）与执行（经 writer 写入）分离，供对账引擎（§4.2）复用。

## 后果

正面：

- DNS 写入入口唯一，可审计、可加统一日志与指标。
- `planSync` 是纯函数，可用 Vitest 覆盖全部边界（新增 / 更新 / 删除 / 无变化），无需 mock 上游。
- 策略不一致只能在 planner 一处产生，消灭"同一 CNAME 两种 proxied"这类漂移。
- 与 D4 所有权表天然组合：写前校验在 writer 内统一完成。

负面：

- writer 成为写入热点，任何产品线的特殊需求都想往里加分支，需要坚持"策略在 planner、执行在 writer"的边界。
- "先算计划、再执行"存在 TOCTOU 窗口：执行前必须重新校验所有权与记录现状，否则计划可能基于过期快照。
- 迁移期存在旧写路径与新 writer 并存的阶段，必须一次性删除旧路径，禁止长期双轨。

## 替代方案

- **各产品线自行写入（现状）**：否决。正是 B3（隧道 CNAME 可被夺取）、B4（SaaS 清理误删人工记录）等缺陷的来源。
- **引入 ORM / 数据层统一写入**：否决。项目坚持本地 JSON 与最小依赖，ORM 与规模不匹配。
- **用事件总线解耦（"记录变更事件"）**：否决。为单进程单用户引入异步事件语义，复杂度远超收益，且蓝图明确禁止重建 EventBus 层。

## 验证计划

- 单元：`planSync` 覆盖 create / update / delete / 幂等无变化四类输入。
- 集成：三条产品线的同步走同一 writer；并发写同一 FQDN 被串行化（配合 D4）。
- 回归：`probe:functional`、`probe:tunnel-route`、`probe:workflow` 保持绿。
