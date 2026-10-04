# ADR-0008：前端四层分层与 TanStack Query

- 状态：Accepted（实现进行中，尚未落地）
- 日期：2026-10-04
- 依据：`dns-pro-target-architecture.md` §3 D8
- 相关代码（现状）：`web/src/shared/api`、`web/src/shared/job`、`web/src/shared/lib`、`web/src/shared/ui`、`web/src/features/*`

## 背景

前端问题集中在"同一语义多套实现"：

- "最新请求胜出"至少 4 套独立实现，并发/作用域机制共 7 套（其中 4 套语义重复）。
- 列表骨架（筛选 / 分页 / 选择 / 空态）重复 6 份，约 600 行样板。
- 写后策略 3 种并存：全量重载 / 本地删除 / 本地 patch，同一个动作在不同页面行为不同。
- 类型手写 + 二次映射双层：后端字段与前端模型之间没有单一映射点，`Record<string, unknown>` 渗入业务代码。

当前 `web/src/shared` 实际只有 `api` / `job` / `lib` / `ui` 四目录，没有查询缓存层；`web/package.json` 也没有任何查询库依赖。

## 决策

按数据流分层，逐层只做一件事：

```text
transport（裸 fetch：同源 / 超时 / 取消 / 错误归一）
  → api（TypeBox 生成的类型 + 路径常量）
    → domain（单一映射：上游 DTO → 内部模型，收口 Cloudflare / DNSPod 差异）
      → query（TanStack Query：缓存 / 失效 / 重试 / 去重）
```

配套：

- `ResourceList` 泛型表格收敛列表样板（筛选 / 分页 / 选择 / 空态）。
- 保留 `scope-generation` 薄层：作用域切换时作废在飞请求，这是 RQ 不直接覆盖的语义（并发原语目标 ≤2 套）。
- 写后策略统一为 mutation `onSettled` 单一约定。
- 不在四层之外新增 `entities` / `widgets` / `processes` 等 FSD 层。

## 后果

正面：

- 并发原语收敛到 2 套（RQ + scope），删除 4 套重复语义与约 1000 行样板。
- 类型从后端 schema 生成，前端零手抄，漂移在编译期暴露（配合 Phase 3 契约链路）。
- 缓存、失效、重试、请求去重由成熟库承担，不再自研。

负面：

- 新增运行时依赖（`@tanstack/vue-query`）：与"最小依赖哲学"存在张力，需要按复杂度预算单独批准，并在 ADR 中留下理由。
- 新增概念成本：query key 设计、失效粒度、`staleTime` 语义；key 设计不当会造成过度失效或脏数据。
- 迁移期两套数据流并存是最大风险：必须按功能域一次性切换，禁止"新页面用 RQ、旧页面用旧机制"长期共存。

## 替代方案

- **继续自研并发原语**：否决。已有 7 套，认知成本高，且每新增一个页面都在复制第 8 套。
- **用 Pinia 承担缓存**：否决。Pinia 是状态容器，不提供缓存失效、重试、请求去重与后台刷新语义，最终还是要自研一遍。
- **引入完整 FSD 分层**：否决。项目是四层轻量切片，加层数与依赖规则不匹配，蓝图明确禁止。
- **不做 `domain` 层，直接在 api 层映射**：否决。Cloudflare / DNSPod 的字段差异会重新散落到各 feature，回到双层映射的老问题。

## 验证计划

- 单元 / 组件测试（Vitest）覆盖 `domain` 映射与 `ResourceList` 行为。
- 迁移完成判据：`Record<string, unknown>` 在业务代码中消失；并发原语 ≤2 套；净删约 1000 行。
- 回归：`npm run probe:job`、`npm run probe:functional`、`npm run probe:static` 保持绿。
