import { describe, expect, it } from 'vitest'
import { SaaSDnsSyncWorkflow } from './saas-dns-sync.workflow.js'

/**
 * 迁移自 scripts/isolated-saas-dns-repair-probe.ts（workflow 侧；前端入口断言见 scripts 下的 UI 契约测试）。
 *
 * repair 必须复用既有 upsert（sync）且每次只委托一次：修复动作若另写一套记录展开逻辑，
 * 「手动修复」与「自动同步」就会给出不同的 DNS 结果；幂等由底层 upsert 保证，重放不产生额外写入编排。
 */

describe('repairHostnameDns：复用既有 upsert 而非另写一套', () => {
  it('每次修复恰好委托一次 sync，并把结果作为 dns 副作用返回', async () => {
    const calls: string[] = []
    const sync = {
      async sync(_providerId: string, _zoneName: string, hostname: string) {
        calls.push(`sync:${hostname}`)
        return { status: 'completed', records: [{ type: 'CNAME', status: 'updated' }] }
      },
    }
    const workflow = new SaaSDnsSyncWorkflow({} as never, {} as never, sync as never)
    const repair = (
      workflow as unknown as {
        repairHostnameDns(providerId: string, zoneName: string, hostname: string): Promise<Record<string, unknown>>
      }
    ).repairHostnameDns

    const result = await repair.call(workflow, 'saas', 'example.com', 'www.example.com')
    expect(calls).toEqual(['sync:www.example.com'])
    expect(result.hostname).toBe('www.example.com')
    const effects = result.side_effects as { dns?: { sync?: { status?: string } } } | undefined
    expect(effects?.dns?.sync?.status).toBe('completed')

    // 幂等：重放只是再次单次委托，不展开成多次写入编排
    const replay = await repair.call(workflow, 'saas', 'example.com', 'www.example.com')
    expect(calls).toEqual(['sync:www.example.com', 'sync:www.example.com'])
    expect(replay.hostname).toBe('www.example.com')
  })
})
