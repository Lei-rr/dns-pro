import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * 迁移自 scripts/isolated-saas-dns-repair-probe.ts 的前端静态断言。
 *
 * SaaS 与 EdgeOne 的修复入口必须统一为「修复域名解析」（不再出现「同步 CNAME」），
 * 且面板把 @repair-dns 事件接上修复动作：文案分裂或事件没接线时，用户点了按钮没有任何反应。
 */

const root = new URL('../', import.meta.url)

async function source(file: string): Promise<string> {
  return await readFile(new URL(file, root), 'utf8')
}

describe('修复域名解析入口统一', () => {
  it('EdgeOne 与 SaaS 表格使用同一文案，面板接上 @repair-dns 事件', async () => {
    const edgeTable = await source('web/src/features/edge-one/ui/AccelerationDomainsTable.vue')
    const edgePanel = await source('web/src/features/edge-one/ui/AccelerationDomainsPanel.vue')
    const saasTable = await source('web/src/features/saas/ui/SaasHostsTable.vue')
    const saasPanel = await source('web/src/features/saas/ui/SaasHostsPanel.vue')

    expect(edgeTable).toMatch(/>修复域名解析/)
    expect(edgeTable).not.toMatch(/>同步 CNAME/)
    expect(edgePanel).toMatch(/@repair-dns=/)
    expect(saasTable).toMatch(/>修复域名解析/)
    expect(saasPanel).toMatch(/@repair-dns=/)
  })
})
