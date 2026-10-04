#!/usr/bin/env node
/**
 * F6 探针：关键操作审计（批量 / 凭据变更 / 会话吊销）。
 * 审计的权威留痕是日志；内存环形缓冲只为 UI 提供最近事件的查询入口（不持久化）。
 * 探针校验：缓冲语义（最新在前 / 容量上限）+ 三类动作真的在写路径上落点 + 路由已注册。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { AuditLog, auditActor } from '../server/src/kernel/observability/audit-log.js'

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

assert.ok(first.id !== '' && third.id !== '', 'events must be identified')
assert.match(first.at, /^\d{4}-\d{2}-\d{2}T/)
assert.deepEqual(logged, [
  'batch:cloudflare:p1/example.com',
  'credential_change:provider-1',
  'session_revoked:auth.session',
])
assert.deepEqual(
  audit.list().map((event) => event.action),
  ['session_revoked', 'credential_change'],
  'list() returns the newest events first and honours capacity'
)
assert.equal(audit.list()[0].detail.operation, undefined)

// 动作白名单：批量 / 凭据变更 / 会话吊销三类
assert.deepEqual(
  new Set([first.action, second.action, third.action]),
  new Set(['batch', 'credential_change', 'session_revoked'])
)

const root = new URL('../', import.meta.url)
const read = async (file: string) => await readFile(new URL(file, root), 'utf8')
const [auth, providers, dnsBatch, saasBatch, edgeOne, preferred, routes] = await Promise.all(
  [
    'server/src/domains/system/auth/auth.handlers.ts',
    'server/src/use-cases/provider-management/provider-management.handlers.ts',
    'server/src/use-cases/dns-batch/dns-batch.handlers.ts',
    'server/src/use-cases/saas-dns-sync/saas-batch.handlers.ts',
    'server/src/use-cases/edge-one-dns-sync/edge-one-dns-sync.handlers.ts',
    'server/src/use-cases/saas-dns-sync/preferred-apply.handlers.ts',
    'server/src/app/routes.ts',
  ].map(read)
)

assert.match(auth, /action: 'session_revoked'/, 'logout must be audited')
assert.match(auth, /action: 'credential_change'/, 'password change must be audited')
assert.match(providers, /action: 'credential_change'/, 'provider credential changes must be audited')
assert.equal((dnsBatch.match(/action: 'batch'/g) ?? []).length, 3, 'all three dns batch operations must be audited')
assert.equal((saasBatch.match(/action: 'batch'/g) ?? []).length, 2, 'saas batch operations must be audited')
assert.equal((edgeOne.match(/action: 'batch'/g) ?? []).length, 2, 'edgeone batch operations must be audited')
assert.equal((preferred.match(/action: 'batch'/g) ?? []).length, 1, 'preferred apply must be audited')
assert.match(routes, /auditRoutes/, 'audit query endpoint must be registered')

// auditActor：鉴权失败时退回来源 IP，绝不抛错
const actor = await auditActor({
  server: { ctx: { modules: { auth: { service: { authenticate: async () => null } } } } },
  ip: '127.0.0.1',
} as never)
assert.equal(actor, '127.0.0.1')

console.log('audit-probe=ok ring=newest-first actions=batch|credential_change|session_revoked wiring=registered')
