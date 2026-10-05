import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { edgeOneHttpsStatusLabel } from './status'

/**
 * 迁移自 scripts/isolated-edge-one-https-status-probe.ts（P1：纯函数 + 零基建的源码结构断言）。
 * 函数断言覆盖 certificate → 文案映射；结构断言守护表格 HTTPS 列与由 certificate 驱动的单元格。
 */

describe('EdgeOne HTTPS 状态文案（certificate → 展示）', () => {
  it('缺少证书或 mode=disable → 未开启', () => {
    expect(typeof edgeOneHttpsStatusLabel).toBe('function')
    expect(edgeOneHttpsStatusLabel()).toBe('未开启')
    expect(edgeOneHttpsStatusLabel({ mode: 'disable' })).toBe('未开启')
  })

  it('免费证书申请中 / 付费证书已部署 → 复用证书状态文案', () => {
    expect(edgeOneHttpsStatusLabel({ mode: 'eofreecert', items: [{ status: 'applying' }] })).toBe('申请中')
    expect(edgeOneHttpsStatusLabel({ mode: 'sslcert', list: [{ status: 'deployed' }] })).toBe('已部署')
  })

  it('已开启但无证书状态 → 已开启', () => {
    expect(edgeOneHttpsStatusLabel({ mode: 'eofreecert', items: [] })).toBe('已开启')
  })
})

describe('加速域名表格 HTTPS 列结构', () => {
  it('表头含 HTTPS 列、单元格由 certificate 驱动、空行 colspan 覆盖该列', async () => {
    // vitest 以仓库根为 cwd：与探针读同一份源码，只是路径基准不同（vite 下 import.meta.url 非 file 协议）
    const table = await readFile('web/src/features/edge-one/ui/AccelerationDomainsTable.vue', 'utf8')
    expect(table).toMatch(/<TableHead>HTTPS<\/TableHead>/)
    expect(table).toMatch(/edgeOneHttpsStatusLabel\(record\.certificate\)/)
    expect(table).toMatch(/<TableCell colspan="7"/)
  })
})
