# ADR-0004：hostname 级所有权表（写入仲裁）

- 状态：Accepted（实现进行中，尚未落地）
- 日期：2026-10-04
- 依据：`dns-pro-target-architecture.md` §3 D4；缺陷 B3 / B4
- 相关代码（现状）：`server/src/kernel/jobs/job-types.ts`、`server/src/domains/cloudflare/tunnel/tunnel-dns.service.ts`、`server/src/domains/cloudflare/saas/saas-hostname.service.ts`

## 背景

写入互斥只有 zone 级资源键（`job-types.ts:27-38` 的 `ZONE_WRITE_JOB_TYPES`），且**不含隧道**：SaaS 写回与隧道 CNAME 写入可以并发落在同一 FQDN 上。更严重的是归属语义不一致：

- 隧道 `ensureCname` 写入前无归属校验，可覆盖他人记录；而 `removeCname` 有校验（同一文件内的不对称）。
- SaaS 清理按备注匹配删除，可能删掉无备注的人工记录（与代码注释不符）。

即"谁有权写这条记录"这件事没有显式模型，只靠各处的临时判断。

## 决策

引入 hostname 级所有权表作为唯一仲裁依据：

```ts
// (zone, fqdn) → 归属
{ owner: 'saas' | 'tunnel' | 'edgeone' | 'manual'; refId: string }
```

规则：

1. `DnsWriter` 写入前校验所有权：owner 不匹配则拒绝（返回可读错误码，而非静默覆盖）。
2. **删除必须 owner 匹配**；`manual` 记录任何自动流程都不得删除。
3. 未登记 = `manual`（默认最保守），由显式操作升级为派生归属。
4. 所有会写 DNS / 加速域名的任务类型纳入同一资源锁体系，隧道类型补入 `ZONE_WRITE_JOB_TYPES`，使并发写同一 FQDN 被串行化。
5. 归属对用户可见（记录列表 owner 徽标，蓝图 F3），并提供 repair 入口修复漂移。

## 后果

正面：

- 并发写同一 FQDN 被串行化，隧道互相夺取 CNAME 的路径被堵死（B3）。
- 人工记录不会被自动清理删除（B4），有测试证明。
- 归属成为可查询状态：对账（F2）与徽标（F3）都有数据基础。

负面：

- 所有权表本身是持久状态，需要迁移、默认值与一致性维护（源对象删除后如何回收归属）。
- 判断错误的 owner 会导致合法写入被拒：必须提供可读错误码与人工修复路径，否则运维成本转嫁给用户。
- 与 D3 的 writer 强耦合，两者必须一起落地，单独上线任一项都不完整。

## 替代方案

- **只用 zone 级锁**：否决。粒度太粗（同 zone 内不冲突的写入被串行化），且完全不解决误删与夺取。
- **依赖外部数据库唯一约束 / 行锁**：否决。单进程单数据目录是既定部署边界，引入数据库违反用户约束。
- **在每条记录上写特殊备注表示归属**：否决。备注是用户可见字段，会被编辑；把归属藏在备注里正是 B4 的成因。

## 验证计划

- 单元：`(zone, fqdn)` 归属判定与 writer 拒绝路径。
- 集成：并发触发 SaaS 与隧道写入同一 FQDN，验证串行化且无覆盖。
- 回归：无备注人工记录在全量清理流程后仍存在（B4 反例测试）。
