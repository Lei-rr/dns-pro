import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DnsRecordDisplayRow } from '@/features/dns/lib/record-display'
import type { DnsRecord } from '@/features/dns/model/types'
import RecordsTable from './RecordsTable.vue'

/**
 * 行内选择框的可访问名称：单元格内没有可计算名称的文本，必须显式 aria-label，
 * 否则辅助技术下是无名控件（表头同款控件早已带 aria-label）。
 * 覆盖三种行形态：折叠分组行、组内记录行、单条记录行。
 */

vi.mock('@/shared/ui/tooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/ui/tooltip')>()
  return { ...actual, AppTooltip: { props: ['content'], template: '<span><slot /></span>' } }
})

function record(id: string, name: string): DnsRecord {
  return { id, name, type: 'CNAME', value: `${name}.target.example.com`, line: '默认' }
}

const groupRows: DnsRecordDisplayRow[] = [
  {
    kind: 'group',
    hostKey: 'api',
    label: 'api',
    records: [record('1', 'api'), record('2', 'api')],
    key: 'g:api',
  },
  { kind: 'single', record: record('3', 'www'), key: 'r:3' },
]

const wrappers: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})

describe('RecordsTable 行内选择框可访问名称', () => {
  it('分组行、组内记录行与单条记录行的选择框都有 aria-label', () => {
    const wrapper = mount(RecordsTable, {
      props: {
        rows: groupRows,
        records: [record('1', 'api'), record('2', 'api'), record('3', 'www')],
        selectedKeys: [],
        expandedHosts: { api: true },
        zoneName: 'example.com',
        isCloudflare: false,
        loading: false,
        refreshing: false,
        busy: () => false,
      },
    })
    wrappers.push(wrapper)

    const labels = wrapper.findAll('[data-slot="checkbox"]').map((box) => box.attributes('aria-label'))
    // 表头 1 + 分组行 1 + 组内 2 + 单条 1
    expect(labels).toHaveLength(5)
    for (const label of labels) expect(String(label || '').trim()).not.toBe('')
    expect(labels[1]).toBe('选择 api 分组的全部记录')
    expect(labels[2]).toBe('选择 api 的 CNAME 记录')
    expect(labels[4]).toBe('选择 www 的 CNAME 记录')
  })
})
