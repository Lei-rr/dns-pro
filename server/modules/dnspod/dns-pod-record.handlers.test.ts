import { describe, expect, it } from 'vitest'
import { listDnsPodRecordsHandler } from './dns-pod-record.handlers.js'

/**
 * 归属查询失败不得降级成 manual：manual 的语义是「无派生归属、自动化流程不会删除该记录」，
 * 与「暂时查不到」正好相反。失败时响应干脆不返回 owner 字段，前端按未知归属处理（不渲染徽标）。
 */

/** 最小请求/响应桩：handler 只读 params / query / server.ctx.modules 与 log */
function stubRequest(claimsFor: () => Promise<unknown>) {
  const warnings: unknown[] = []
  let sent: unknown
  const request = {
    params: { providerId: 'dp-1', zone: 'example.com' },
    query: {},
    server: {
      ctx: {
        modules: {
          dnsPod: {
            records: {
              list: async () => ({ items: [{ name: 'www', type: 'A', value: '1.2.3.4' }], pagination: {} }),
            },
          },
          ownership: { claimsFor },
        },
      },
    },
    log: { warn: (...args: unknown[]) => warnings.push(args) },
  }
  const reply = {
    send: (payload: unknown) => {
      sent = payload
      return payload
    },
  }
  return {
    request,
    reply,
    warnings,
    items: () => (sent as { data: { items: Array<Record<string, unknown>> } }).data.items,
  }
}

describe('DNSPod 记录列表：归属徽标降级策略', () => {
  it('归属查询失败时省略 owner 字段，不得降级成 manual', async () => {
    const stub = stubRequest(async () => {
      throw new Error('upstream rate limited')
    })

    await listDnsPodRecordsHandler(stub.request as never, stub.reply as never)

    const item = stub.items()[0] as Record<string, unknown>
    expect(item.name).toBe('www')
    expect('owner' in item).toBe(false)
    expect(stub.warnings).toHaveLength(1)
  })

  it('归属查询成功时按派生关系返回 owner（回归对照）', async () => {
    const stub = stubRequest(async () => [{ fqdn: 'www.example.com', owner: 'saas', refId: 'h-1' }])

    await listDnsPodRecordsHandler(stub.request as never, stub.reply as never)

    expect(stub.items()[0]?.owner).toBe('saas')
  })
})
