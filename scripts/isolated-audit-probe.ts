#!/usr/bin/env node
/**
 * F6 探针：关键操作审计（批量 / 凭据变更 / 会话吊销 / 派生记录对账）。
 * 审计的权威留痕是日志；内存环形缓冲只为 UI 提供最近事件的查询入口（不持久化）。
 * 探针校验：缓冲语义（最新在前 / 容量上限）+ 四类动作真的在写路径上落点 + 路由已注册。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { AuditLog, auditActor, type AuditAction } from '../server/core/observability/audit-log.js'

const logged: string[] = []
const audit = new AuditLog((event) => logged.push(`${event.action}:${event.target}`), 2)

const first = audit.record({
  action: 'batch',
  actor: 'admin',
  target: 'cloudflare:p1/example.com',
  detail: { operation: 'create' },
})
const second = audit.record({ action: 'credential_change', actor: 'admin', target: 'provider-1' })
const third = audit.record({ action: 'session_revoked', actor: 'admin', target: 'auth.session' })
const fourth = audit.record({
  action: 'reconcile',
  actor: 'admin',
  target: 'derived-records:all/all',
  detail: { scope: {}, summary: { total: 0 } },
})

assert.ok(first.id !== '' && fourth.id !== '', 'events must be identified')
assert.match(first.at, /^\d{4}-\d{2}-\d{2}T/)
assert.deepEqual(logged, [
  'batch:cloudflare:p1/example.com',
  'credential_change:provider-1',
  'session_revoked:auth.session',
  'reconcile:derived-records:all/all',
])
assert.deepEqual(
  audit.list().map((event) => event.action),
  ['reconcile', 'session_revoked'],
  'list() returns the newest events first and honours capacity'
)
assert.equal(audit.list()[0].detail.operation, undefined)

// 动作白名单：批量 / 凭据变更 / 会话吊销 / 派生记录对账四类
const actions: AuditAction[] = [first.action, second.action, third.action, fourth.action]
assert.deepEqual(new Set(actions), new Set(['batch', 'credential_change', 'session_revoked', 'reconcile']))

const root = new URL('../', import.meta.url)
const read = async (file: string) => await readFile(new URL(file, root), 'utf8')
const [auth, providers, dnsBatch, saasBatch, edgeOne, preferred, reconcile, routes] = await Promise.all(
  [
    'server/modules/system/auth/auth.handlers.ts',
    'server/workflows/provider-management/provider-management.handlers.ts',
    'server/workflows/dns-batch/dns-batch.handlers.ts',
    'server/workflows/saas-dns-sync/saas-batch.handlers.ts',
    'server/workflows/edge-one-dns-sync/edge-one-dns-sync.handlers.ts',
    'server/workflows/saas-dns-sync/preferred-apply.handlers.ts',
    'server/workflows/derived-records/reconcile.handlers.ts',
    'server/app/routes.ts',
  ].map(read)
)

assert.match(auth, /action: 'session_revoked'/, 'logout must be audited')
assert.match(auth, /action: 'credential_change'/, 'password change must be audited')
assert.match(providers, /action: 'credential_change'/, 'provider credential changes must be audited')
// 三个批量操作共用同一审计入口：入口调用三次、action 只有一份、三种操作字面量齐全
assert.equal(
  (dnsBatch.match(/recordBatchAudit\(request, \{/g) ?? []).length,
  3,
  'all three dns batch operations must be audited'
)
assert.match(dnsBatch, /action: 'batch'/, 'dns batch audit must record the batch action')
for (const operation of ['create', 'delete', 'update']) {
  assert.match(dnsBatch, new RegExp(`operation: '${operation}'`), `dns batch ${operation} must be audited`)
}
assert.equal((saasBatch.match(/action: 'batch'/g) ?? []).length, 2, 'saas batch operations must be audited')
assert.equal((edgeOne.match(/action: 'batch'/g) ?? []).length, 2, 'edgeone batch operations must be audited')
assert.equal((preferred.match(/action: 'batch'/g) ?? []).length, 1, 'preferred apply must be audited')
// 对账走同一审计入口（不再用 request.log.info 旁路留痕）
assert.match(reconcile, /action: 'reconcile'/, 'reconcile must be audited')
assert.match(reconcile, /platform\.audit\.record/, 'reconcile must record through the audit log')
assert.match(routes, /auditRoutes/, 'audit query endpoint must be registered')

// auditActor：已鉴权取用户名，未鉴权路径退回来源 IP，绝不抛错
assert.equal(auditActor({ ip: '127.0.0.1' } as never), '127.0.0.1')
assert.equal(auditActor({ ip: '127.0.0.1', authActor: 'guolei' } as never), 'guolei')

console.log(
  'audit-probe=ok ring=newest-first actions=batch|credential_change|session_revoked|reconcile wiring=registered'
)
