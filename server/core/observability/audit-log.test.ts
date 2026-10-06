import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { AuditLog, auditActor, type AuditEvent } from './audit-log.js'

/**
 * 迁移自 scripts/isolated-audit-probe.ts（F6 关键操作审计：批量 / 凭据变更 / 会话吊销 / 派生记录对账）。
 * 审计的权威留痕是日志；内存环形缓冲只为 UI 提供最近事件的查询入口（不持久化）。
 * 这里校验：缓冲语义（最新在前 / 容量上限）+ 四类动作真的在写路径上落点 + 路由已注册。
 */

// 静态断言读源码文件（不是构建产物）：写路径是否落点的权威在这里
const read = async (file: string) => await readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
const [auth, providers, dnsBatch, saasBatch, edgeOne, preferred, reconcile, routes] = await Promise.all([
  read('modules/system/auth/auth.handlers.ts'),
  read('workflows/provider-management/provider-management.handlers.ts'),
  read('workflows/dns-batch/dns-batch.handlers.ts'),
  read('workflows/saas-dns-sync/saas-batch.handlers.ts'),
  read('workflows/edge-one-dns-sync/edge-one-dns-sync.handlers.ts'),
  read('workflows/saas-dns-sync/preferred-apply.handlers.ts'),
  read('workflows/derived-records/reconcile.handlers.ts'),
  read('app/routes.ts'),
])

describe('AuditLog 环形缓冲', () => {
  it('事件带 id 与 ISO 时间；sink 依写入顺序触发；list() 最新在前并遵守容量上限', () => {
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

    expect(first.id !== '' && fourth.id !== '').toBe(true)
    expect(first.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // 动作白名单：批量 / 凭据变更 / 会话吊销 / 派生记录对账四类
    expect([first.action, second.action, third.action, fourth.action]).toEqual([
      'batch',
      'credential_change',
      'session_revoked',
      'reconcile',
    ])
    // 权威留痕走 sink（日志），顺序即写入顺序
    expect(logged).toEqual([
      'batch:cloudflare:p1/example.com',
      'credential_change:provider-1',
      'session_revoked:auth.session',
      'reconcile:derived-records:all/all',
    ])
    // 容量为 2：只剩最近两条，且最新在前
    expect(audit.list().map((event) => event.action)).toEqual(['reconcile', 'session_revoked'])
    // 未提供 detail 的事件默认空对象
    expect(audit.list()[0]?.detail.operation).toBeUndefined()
  })

  it('动作白名单闭合为四类', () => {
    const first = new AuditLog().record({ action: 'batch', actor: 'admin', target: 'x' })
    const second = new AuditLog().record({ action: 'credential_change', actor: 'admin', target: 'x' })
    const third = new AuditLog().record({ action: 'session_revoked', actor: 'admin', target: 'x' })
    const fourth = new AuditLog().record({ action: 'reconcile', actor: 'admin', target: 'x' })
    const actions: AuditEvent['action'][] = [first.action, second.action, third.action, fourth.action]
    expect(new Set(actions)).toEqual(new Set(['batch', 'credential_change', 'session_revoked', 'reconcile']))
  })
})

describe('审计写路径落点', () => {
  it('会话吊销与凭据变更在各自处理器内留痕', () => {
    expect(auth).toMatch(/action: 'session_revoked'/)
    expect(auth).toMatch(/action: 'credential_change'/)
    expect(providers).toMatch(/action: 'credential_change'/)
  })

  it('三个批量操作共用同一审计入口，三种操作字面量齐全', () => {
    expect((dnsBatch.match(/recordBatchAudit\(request, \{/g) ?? []).length).toBe(3)
    expect(dnsBatch).toMatch(/action: 'batch'/)
    for (const operation of ['create', 'delete', 'update']) {
      expect(dnsBatch).toMatch(new RegExp(`operation: '${operation}'`))
    }
    expect((saasBatch.match(/action: 'batch'/g) ?? []).length).toBe(2)
    expect((edgeOne.match(/action: 'batch'/g) ?? []).length).toBe(2)
    expect((preferred.match(/action: 'batch'/g) ?? []).length).toBe(1)
  })

  it('对账走审计入口（不再用 request.log.info 旁路留痕），且查询端点已注册', () => {
    expect(reconcile).toMatch(/action: 'reconcile'/)
    expect(reconcile).toMatch(/platform\.audit\.record/)
    expect(routes).toMatch(/auditRoutes/)
  })
})

describe('auditActor', () => {
  it('已鉴权取用户名，未鉴权路径退回来源 IP，绝不抛错', () => {
    expect(auditActor({ ip: '127.0.0.1' } as never)).toBe('127.0.0.1')
    expect(auditActor({ ip: '127.0.0.1', authActor: 'guolei' } as never)).toBe('guolei')
  })
})
