import { readFile } from 'node:fs/promises'
import type { FastifyReply } from 'fastify'
import { describe, expect, it } from 'vitest'
import { AuditLog, auditActor, type AuditEvent } from './audit-log.js'
import {
  createDnsBatchHandler,
  deleteDnsBatchHandler,
  updateDnsBatchHandler,
} from '../../workflows/dns-batch/dns-batch.handlers.js'
import {
  createSaaSBatchDeleteHandler,
  createSaaSBatchUpdateHandler,
} from '../../workflows/saas-dns-sync/saas-batch.handlers.js'
import {
  createEdgeOneBatchDeleteHandler,
  createEdgeOneBatchDisableHandler,
} from '../../workflows/edge-one-dns-sync/edge-one-dns-sync.handlers.js'
import { createPreferredApplyHandler } from '../../workflows/saas-dns-sync/preferred-apply.handlers.js'

/**
 * 迁移自 scripts/isolated-audit-probe.ts（F6 关键操作审计：批量 / 凭据变更 / 会话吊销）。
 * 审计的权威留痕是日志；内存环形缓冲只为 UI 提供最近事件的查询入口（不持久化）。
 * 这里校验：缓冲语义（最新在前 / 容量上限）+ 批量入口走真实 handler 落在 sink 上
 * + 其余动作与查询路由的源码落点（凭据变更 / 会话吊销的链路上游在各自测试域覆盖）。
 */

// 静态断言读源码文件（不是构建产物）：写路径是否落点的权威在这里
const read = async (file: string) => await readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
const [auth, providers, routes] = await Promise.all([
  read('modules/system/auth/auth.handlers.ts'),
  read('workflows/provider-management/provider-management.handlers.ts'),
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

    expect(first.id !== '' && third.id !== '').toBe(true)
    expect(first.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // 动作白名单：批量 / 凭据变更 / 会话吊销三类
    expect([first.action, second.action, third.action]).toEqual(['batch', 'credential_change', 'session_revoked'])
    // 权威留痕走 sink（日志），顺序即写入顺序
    expect(logged).toEqual([
      'batch:cloudflare:p1/example.com',
      'credential_change:provider-1',
      'session_revoked:auth.session',
    ])
    // 容量为 2：只剩最近两条，且最新在前
    expect(audit.list().map((event) => event.action)).toEqual(['session_revoked', 'credential_change'])
    // 未提供 detail 的事件默认空对象
    expect(audit.list()[0]?.detail.operation).toBeUndefined()
  })

  it('动作白名单闭合为三类', () => {
    const first = new AuditLog().record({ action: 'batch', actor: 'admin', target: 'x' })
    const second = new AuditLog().record({ action: 'credential_change', actor: 'admin', target: 'x' })
    const third = new AuditLog().record({ action: 'session_revoked', actor: 'admin', target: 'x' })
    const actions: AuditEvent['action'][] = [first.action, second.action, third.action]
    expect(new Set(actions)).toEqual(new Set(['batch', 'credential_change', 'session_revoked']))
  })
})

/** 最小回复桩：批量 handler 只调用 reply.status(...).send(...)，返回值不参与断言 */
type ReplyStub = { status(code: number): ReplyStub; send(payload: unknown): unknown }
const replyStub: ReplyStub = { status: () => replyStub, send: (payload) => payload }
const stubReply = replyStub as unknown as FastifyReply

/** 最小请求桩：批量 handler 只读 server.ctx / params / body / ip（auditActor 回退用）；as never 适配各自的 FastifyRequest 泛型 */
function stubRequest(input: {
  audit: AuditLog
  workflows: Record<string, unknown>
  params: Record<string, string>
  body: Record<string, unknown>
}): never {
  return {
    server: { ctx: { platform: { audit: input.audit }, workflows: input.workflows } },
    params: input.params,
    body: input.body,
    ip: '198.51.100.7',
  } as never
}

describe('审计写路径落点', () => {
  it('会话吊销与凭据变更在各自处理器内留痕', () => {
    expect(auth).toMatch(/action: 'session_revoked'/)
    expect(auth).toMatch(/action: 'credential_change'/)
    expect(providers).toMatch(/action: 'credential_change'/)
  })

  it('三个批量操作共用同一审计入口，sink 逐条收到完整记录', async () => {
    const events: AuditEvent[] = []
    const audit = new AuditLog((event) => events.push(event))
    const request = (
      params: Record<string, string>,
      body: Record<string, unknown>,
      workflows: Record<string, unknown>
    ) => stubRequest({ audit, workflows, params, body })

    // DNS 三个批量操作（create / delete / update）全部走真实 handler
    const dnsBatch = {
      createCreate: async () => ({ id: 'job-create' }),
      createDelete: async () => ({ id: 'job-delete' }),
      createUpdate: async () => ({ id: 'job-update' }),
    }
    const zoneParams = { providerId: 'cf-1', zone: 'example.com' }
    await createDnsBatchHandler('cloudflare')(
      request(zoneParams, { records: [{ name: 'www', type: 'A', value: '192.0.2.1' }] }, { dnsBatch }),
      stubReply
    )
    await deleteDnsBatchHandler('cloudflare')(
      request(zoneParams, { records: [{ id: 'record-1' }] }, { dnsBatch }),
      stubReply
    )
    await updateDnsBatchHandler('cloudflare')(
      request(zoneParams, { records: [{ id: 'record-1' }], patch: { value: '192.0.2.2' } }, { dnsBatch }),
      stubReply
    )

    // SaaS / EdgeOne / 优选应用三条产品线的批量入口同样落在同一 sink 上
    const saasBatch = {
      createDelete: async () => ({ id: 'saas-job-delete' }),
      createUpdate: async () => ({ id: 'saas-job-update' }),
    }
    await createSaaSBatchDeleteHandler(
      request({ providerId: 'saas-1', zoneName: 'example.com' }, { hostnames: ['a.example.com'] }, { saasBatch }),
      stubReply
    )
    await createSaaSBatchUpdateHandler(
      request(
        { providerId: 'saas-1', zoneName: 'example.com' },
        { hostnames: ['a.example.com'], patch: { value: '192.0.2.3' } },
        { saasBatch }
      ),
      stubReply
    )

    const edgeOneBatch = {
      createDisable: async () => ({ id: 'edge-job-disable' }),
      createDelete: async () => ({ id: 'edge-job-delete' }),
    }
    await createEdgeOneBatchDisableHandler(
      request({ providerId: 'eo-1', zoneId: 'zone-1' }, { domains: ['a.example.com'] }, { edgeOneBatch }),
      stubReply
    )
    await createEdgeOneBatchDeleteHandler(
      request({ providerId: 'eo-1', zoneId: 'zone-1' }, { domains: ['a.example.com'] }, { edgeOneBatch }),
      stubReply
    )

    const saasPreferredApply = { create: async () => ({ id: 'preferred-job-1' }) }
    await createPreferredApplyHandler(
      request(
        { providerId: 'saas-1', zoneName: 'example.com' },
        { preferred_domain: 'pref.example.com', hostnames: ['a.example.com'] },
        { saasPreferredApply }
      ),
      stubReply
    )

    // sink 实际收到的记录：动作 / 目标 / 操作逐条核对（空记录、错目标或串操作都过不了）
    expect(events.map((event) => [event.action, event.target])).toEqual([
      ['batch', 'cloudflare:cf-1/example.com'],
      ['batch', 'cloudflare:cf-1/example.com'],
      ['batch', 'cloudflare:cf-1/example.com'],
      ['batch', 'saas:saas-1/example.com'],
      ['batch', 'saas:saas-1/example.com'],
      ['batch', 'edgeone:eo-1/zone-1'],
      ['batch', 'edgeone:eo-1/zone-1'],
      ['batch', 'saas-preferred:saas-1/example.com'],
    ])
    expect(events.map((event) => event.detail.operation)).toEqual([
      'create',
      'delete',
      'update',
      'delete',
      'update',
      'disable',
      'delete',
      'preferred_apply',
    ])
    // DNS 三个操作共用 recordBatchAudit：detail 形状（job_id / 条目数）与操作者同样来自真实路径
    expect(events[0]).toMatchObject({
      action: 'batch',
      actor: '198.51.100.7',
      target: 'cloudflare:cf-1/example.com',
      detail: { operation: 'create', job_id: 'job-create', records: 1 },
    })
  })

  it('审计查询端点已注册', () => {
    expect(routes).toMatch(/auditRoutes/)
  })
})

describe('auditActor', () => {
  it('已鉴权取用户名，未鉴权路径退回来源 IP，绝不抛错', () => {
    expect(auditActor({ ip: '127.0.0.1' } as never)).toBe('127.0.0.1')
    expect(auditActor({ ip: '127.0.0.1', authActor: 'guolei' } as never)).toBe('guolei')
  })
})
