# ADR-0001：厂商差异收敛为 ProviderAdapter 与 DnsRecordPort

- 状态：Accepted（D1-1 已落地；`ProviderAdapter` 能力声明与编解码部分进行中）
- 日期：2026-10-04
- 依据：`dns-pro-target-architecture.md` §3 D1；落地提交 `4fcb741`
- 相关代码：`server/core/contracts/dns-record.port.ts`、`server/modules/cloudflare/dns/cloudflare-record.adapter.ts`、`server/modules/dnspod/dns/dnspod-record.adapter.ts`、`server/workflows/dns-batch/dns-batch.workflow.ts`

## 背景

引入本决策前，厂商差异铺在四处：严格 schema（单条 CRUD）与宽松 schema（批量）互不一致；记录 payload 构造带厂商分支；各模块自带适配逻辑；工作流里出现 `providerType === ...` 判断，平台层甚至认识 DNS 键名。

后果是"加一个厂商"要同时改 schema、payload、工作流与平台常量；同一件事（判断两条记录是否等价）存在两套实现，容易分叉。

深读结论：厂商差异实际只有三样——**寻址**（zone / 主机记录表示）、**字段形状**（`content` vs `value`、线路与备注）、**能力**（priority / remark / proxied / line / weight / enabled）。

## 决策

1. 在 `core/contracts/` 定义厂商无关的记录值模型与端口 `DnsRecordPort`（`find` / `create` / `update` / `remove`），并把幂等重放判定收敛为纯函数 `dnsRecordMatches`（域名类值忽略大小写与尾点）。
2. 每个厂商提供一个适配器实现端口，厂商字段映射只允许出现在适配器：Cloudflare（`content` / `comment`）与 DNSPod（`subdomain` / `record_line` / `mx`）。
3. 用例只依赖端口注册表 `Record<DnsProviderType, DnsRecordPort>`（`dns-batch.workflow.ts:38`），批量路径不再出现厂商分支；删除 `dns-batch.adapters.ts` 与 `dns-record-equivalence.ts`。
4. 进行中：把"能力声明 + `encodeCreate` / `encodeUpdate` / `decode` / `recordKey`"提炼为 `ProviderAdapter`，让端口实现由 adapter 组合，`kernel` 与 `workflows` 内厂商判断归零。

## 后果

正面：

- 新增厂商 = 新建 adapter 目录 + 注册，工作流零改动。
- 等值判定只有一份实现，批量幂等（B1）与去重口径统一。
- 厂商字段转换集中在适配器，可脱离 HTTP 单测。

负面：

- 多一层间接：调用方必须经端口，不能直接取 service。
- 端口是最小公共集，厂商特有字段靠 `DnsRecordValue` 的可选字段承载，长期有膨胀风险。
- 迁移期存在 service 与 adapter 并存的读路径，必须有一次收尾删除，否则形成长期双轨。

## 替代方案

- **在 service 内部 switch 厂商**：否决。分支留在业务层，每加厂商都要改用例，等值判定会再次分裂。
- **泛型 + 类型体操表达厂商差异**：否决。收益仅在编译期，阅读成本与错误信息代价过高，与项目规模不匹配。
- **合并 DNSPod 与 Cloudflare DNS 为统一实现**：否决。语义差异大（线路与权重 vs proxied 与 TTL 规则），合并即巨兽，属于蓝图明确排除项。

## 验证与遗留

- `npm run arch:final`、`server/app/api-contract.test.ts` 等 API 契约测试、`server/workflows/saas-dns-sync/saas-batch.workflow.test.ts` 等批量路径测试（单跑 `npx vitest run <文件>`，全量 `npm run test`）覆盖端口接入与批量路径。
- 遗留（未达成验收）：`workflows/` 已归零，`kernel` 与域内仍有厂商判断——`server/core/providers/provider-presenter.ts:46-66`、`server/modules/dnspod/dns-pod-record-sync.service.ts:77-78`；`ProviderAdapter` 能力面尚未落地。
