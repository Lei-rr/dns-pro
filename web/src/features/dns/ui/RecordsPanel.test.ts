import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dnsApi, type DnsProviderRef } from '@/features/dns/api/dns-api'
import type { DnsRecord } from '@/features/dns/model/types'
import type { ApiResponse } from '@/shared/api/types'
import RecordsPanel from './RecordsPanel.vue'

/**
 * RecordsPanel 列表读路径的组件级测试：
 * 1) 分组先于分页——12 条同主机记录在 pageSize=10 下仍是一个分组，组内计数与组内全选都覆盖整组；
 * 2) 读失败与空列表可区分——失败渲染告警条与失败空态文案，重试成功后恢复。
 * 打桩只在 dns-api 的具名方法上，组件真实调用链（useResourceQuery → dnsApi.records）保持不变。
 */

vi.mock('@/shared/lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}))

// 表格行的复制按钮包在 reka Tooltip 里，而 TooltipProvider 由应用根提供；组件测试里换成轻量 stub
vi.mock('@/shared/ui/tooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/ui/tooltip')>()
  return { ...actual, AppTooltip: { props: ['content'], template: '<span><slot /></span>' } }
})

function ok<T>(data: T): ApiResponse<T> {
  return { code: 0, message: 'success', data }
}

const PROVIDER: DnsProviderRef = { id: 'provider-1', type: 'dnspod', name: '示例服务商' }
const ZONE = 'example.com'

/** 同主机 12 条 CNAME：同 hostKey 多条关联记录，必然折叠为一个分组 */
function apiRecord(index: number): DnsRecord {
  return {
    id: `record-${index}`,
    name: 'api',
    type: 'CNAME',
    value: `target-${index}.example.com`,
    line: '默认',
  }
}

const wrappers: VueWrapper[] = []

async function flush() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

async function mountPanel(records: () => Promise<ApiResponse<DnsRecord[]>>): Promise<VueWrapper> {
  vi.spyOn(dnsApi, 'records').mockImplementation(records)
  vi.spyOn(dnsApi, 'lines').mockImplementation(async () => ok({ items: [{ name: '默认', line_id: '1' }], groups: [] }))
  // onMounted 会探测进行中的批量任务：返回「无任务」，避免任务轮询混进用例
  vi.spyOn(dnsApi, 'batchActive').mockImplementation(async () => ok(null))

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })
  const wrapper = mount(RecordsPanel, {
    attachTo: document.body,
    props: { provider: PROVIDER, zoneId: ZONE },
    global: { plugins: [router, [VueQueryPlugin, { queryClient }]] },
  })
  wrappers.push(wrapper)
  await flush()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  // 12 条记录 + pageSize=10：旧流程（先按记录切片再分组）会得到「10 条」的第一页
  localStorage.setItem('dns-pro:page-size:dns-records', '10')
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('RecordsPanel 先分组后分页', () => {
  it('12 条同主机记录在 pageSize=10 下只渲染一个分组，组内计数为 12 条', async () => {
    const wrapper = await mountPanel(async () => ok(Array.from({ length: 12 }, (_, index) => apiRecord(index + 1))))

    const text = wrapper.text()
    expect(text).toContain('api')
    expect(text).toContain('12 条')
    // 旧流程会在这里显示页内计数「10 条」，并把剩下 2 条留到第二页形成第二个同名分组
    expect(text).not.toContain('10 条')

    // 表头 1 行 + 唯一的分组行 1 行（分组默认折叠）
    expect(wrapper.findAll('tr')).toHaveLength(2)
  })

  it('组内全选覆盖该主机全部 12 条记录（而不是当前页可见的部分）', async () => {
    const wrapper = await mountPanel(async () => ok(Array.from({ length: 12 }, (_, index) => apiRecord(index + 1))))

    // 第一个 checkbox 是表头全选，第二个是分组行的组内全选
    const checkboxes = wrapper.findAll('[data-slot="checkbox"]')
    expect(checkboxes.length).toBeGreaterThanOrEqual(2)
    await checkboxes[1]?.trigger('click')
    await flush()

    const bar = wrapper.find('[data-slot="floating-selection-bar"]')
    expect(bar.exists()).toBe(true)
    expect(bar.text()).toContain('12')
  })
})

describe('RecordsPanel 读失败与空态可区分', () => {
  it('读失败渲染告警条与失败空态（而不是行动号召式空态），重试成功后恢复', async () => {
    const wrapper = await mountPanel(async () => {
      throw new Error('records failed')
    })

    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('解析记录加载失败')
    // 失败空态不得再劝用户「添加记录或导入」，否则会被误当成确实没有数据
    expect(wrapper.text()).toContain('解析记录加载失败')
    expect(wrapper.text()).not.toContain('可通过上方「添加记录」或「导入」快速添加')

    // 重试：数据源恢复后告警条消失、记录出现（refresh 内部有 120ms 的最小刷新时长）
    vi.mocked(dnsApi.records).mockImplementation(async () => ok([apiRecord(1)]))
    await alert.get('button').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flush()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('target-1.example.com')
  })
})
