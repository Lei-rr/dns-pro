# ADR-0006：ApiError.public —— 错误细节由抛出点自声明

- 状态：Accepted（实现进行中，尚未落地）
- 日期：2026-10-04
- 依据：`dns-pro-target-architecture.md` §3 D6
- 相关代码（现状）：`server/app/plugins/error-handler.ts`、`server/core/http/api-error.ts`

## 背景

对外错误体只暴露白名单内的 `details` 键，白名单维护在 `error-handler.ts` 的 `PUBLIC_DETAIL_KEYS`（当前 12 项：`errors`、`dependencies`、`job_id`、`retry_after`、`provider_id`、`expected_type`、`actual_type`、`chain`、`hostname`、`sync_zone`、`code`、`upstream_status`）。

这是"约定多处并行维护"的典型：新增一个错误码想带一个对外字段，必须在另一个文件里加键，否则字段被静默丢弃——症状是前端拿不到上下文，而错误码本身看起来是成功的。反过来，白名单也承担了安全职责（上游原始响应、服务器路径不得外泄），因此不能简单放开。

## 决策

错误在抛出点自声明可公开内容，`error-handler` 退化为纯序列化 + 5xx 脱敏：

```ts
throw new ApiError('upstream_failed', '上游失败', 502, {
  public: { upstream_status: 429, retry_after: 3000 },
})
```

- `ApiError` 增加显式的"可公开细节"语义（例如 `details.public` 或独立字段），只有被声明的键才会进入响应体。
- `error-handler.ts` 删除 `PUBLIC_DETAIL_KEYS` 白名单，只负责：状态码归一、5xx 内部信息脱敏、日志记录、校验错误与限流错误的适配。
- 内部细节（上游原始响应、文件路径、栈）继续只写日志。

## 后果

正面：

- 新增错误码不需要改 `error-handler`，"加字段忘改白名单"这一类漂移从根上消失。
- 公开面在抛出点可见：离数据最近的代码决定什么能对外，评审时一眼可查。
- 错误契约与错误码同处一文件，前端错误码映射表可以对照生成。

负面：

- 失去单点白名单的"默认拒绝"特性：安全边界从"集中白名单"变成"每个抛出点自我约束"，必须靠代码评审与回归测试（`server/app/security.test.ts` 检查不泄露上游响应与路径）兜底。
- 存量 `ApiError` 抛出点数量可观，改造是逐个的机械工作，期间两种语义并存，需要一次收尾。
- 5xx 脱敏逻辑仍需保留，脱敏与"自声明"的职责边界要写清楚，否则容易被误读为"完全放开"。

## 替代方案

- **保留集中白名单**：否决。漂移是结构性的（加一个错误就要改两个文件），且已产生"字段被静默丢弃"的实际症状。
- **完全放开 `details`**：否决。会外泄上游原始响应、文件路径等内部信息，等于放弃现有的安全收益。
- **统一错误中间件里按错误码查表**：否决。本质仍是第二处约定，只是把白名单换成映射表。

## 验证计划

- 单元：自声明细节进入响应体；未声明细节被丢弃；5xx 的 `server_error` 消息不外泄。
- 回归：`server/app/security.test.ts` 保持绿（信息泄露断言不变），`server/app/api-contract.test.ts` 等 API 契约测试覆盖错误码契约（单跑 `npx vitest run <文件>`）。
