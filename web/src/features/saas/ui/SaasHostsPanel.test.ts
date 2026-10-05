import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preferredDomainApi, saasApi } from '@/features/saas/api/saas-api'
import type { SaaSHostname } from '@/features/saas/model/types'
import type { ApiResponse } from '@/shared/api/types'
import { confirmDeleteWithSkipCleanup } from '@/shared/ui/confirm'
import SaasDetailDialog from './SaasDetailDialog.vue'
import SaasHostsPanel from './SaasHostsPanel.vue'
import SaasHostsTable from './SaasHostsTable.vue'

/**
 * 详情「加载」与「刷新」的所有权必须分离（同源回归）：
 * openDetails 在飞时点弹窗里的刷新，曾让两者共用同一个 generation——
 * 刷新 claim 掉加载的 owner 后，加载的 finally 永远跳过 detailLoading=false，详情弹窗卡在加载态。
 */

vi.mock('@/features/saas/api/saas-api', () => ({
  saasApi: {
    hostnames: vi.fn(),
    hostname: vi.fn(),
    reconcileHostname: vi.fn(),
    repairHostnameDns: vi.fn(),
    updateHostname: vi.fn(),
    createHostname: vi.fn(),
    deleteHostname: vi.fn(),
    batchActive: vi.fn(),
    batchJob: vi.fn(),
    batchRetry: vi.fn(),
    preferredApplyActive: vi.fn(),
    preferredApplyJob: vi.fn(),
    preferredApplyRetry: vi.fn(),
    preferredApply: vi.fn(),
    preferredApplyPreview: vi.fn(),
    batchDelete: vi.fn(),
    batchUpdate: vi.fn(),
  },
  preferredDomainApi: {
    list: vi.fn(),
  },
}))

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

// 删除确认弹窗由组件测试单独覆盖；这里只关心勾选结果如何转成接口参数
vi.mock('@/shared/ui/confirm', () => ({
  confirmDeleteWithSkipCleanup: vi.fn(),
  confirmDialog: vi.fn(),
}))

function ok<T>(data: T): ApiResponse<T> {
  return { code: 0, message: 'success', data }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const HOST: SaaSHostname = { id: 'h1', hostname: 'api.example.com', status: 'active' }

const wrappers: VueWrapper[] = []

async function flush() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

beforeEach(() => {
  vi.mocked(saasApi.hostnames).mockResolvedValue(ok([HOST]))
  vi.mocked(saasApi.reconcileHostname).mockResolvedValue(ok({ ...HOST, status: 'active' }))
  vi.mocked(saasApi.batchActive).mockResolvedValue(ok(null))
  vi.mocked(saasApi.preferredApplyActive).mockResolvedValue(ok(null))
  vi.mocked(preferredDomainApi.list).mockResolvedValue(ok([]))
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

/** 挂载面板：详情/删除都走真实调用链（只在 API 层与确认弹窗处打桩） */
async function mountPanel(): Promise<VueWrapper> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })
  const wrapper = mount(SaasHostsPanel, {
    attachTo: document.body,
    props: {
      providerId: 'provider-1',
      zoneName: 'example.com',
      loadDnsZones: async () => [],
      syncProviders: [],
    },
    global: { plugins: [router, [VueQueryPlugin, { queryClient }]] },
  })
  wrappers.push(wrapper)
  await flush()
  return wrapper
}

describe('SaasHostsPanel 详情加载与刷新的所有权隔离', () => {
  it('详情加载在飞时点击刷新，加载请求返回后 detailLoading 正常复位', async () => {
    const loadRequest = deferred<ApiResponse<SaaSHostname>>()
    vi.mocked(saasApi.hostname).mockReturnValue(loadRequest.promise)

    const wrapper = await mountPanel()

    // 打开详情：hostname 请求挂起，detailLoading = true
    wrapper.findComponent(SaasHostsTable).vm.$emit('detail', HOST)
    await nextTick()
    expect(wrapper.findComponent(SaasDetailDialog).props('loading')).toBe(true)

    // 加载未收尾时刷新：两次操作的所有权互不影响
    wrapper.findComponent(SaasDetailDialog).vm.$emit('refresh', HOST)
    await flush()
    expect(wrapper.findComponent(SaasDetailDialog).props('refreshing')).toBe(false)

    // 加载请求返回：detailLoading 必须复位，而不是永久停在加载态
    loadRequest.resolve(ok({ ...HOST, status: 'active' }))
    await flush()

    expect(wrapper.findComponent(SaasDetailDialog).props('loading')).toBe(false)
  })
})

describe('SaasHostsPanel 删除时的 DNS 清理选择', () => {
  it('按勾选结果下发 skipCleanup：不勾保持清理，勾选对应后端 auto_cleanup=false', async () => {
    vi.mocked(saasApi.deleteHostname).mockResolvedValue(ok(HOST))
    const wrapper = await mountPanel()

    vi.mocked(confirmDeleteWithSkipCleanup).mockResolvedValue({ confirmed: true, checked: false })
    wrapper.findComponent(SaasHostsTable).vm.$emit('remove', HOST)
    await flush()
    expect(saasApi.deleteHostname).toHaveBeenCalledWith('provider-1', 'example.com', 'api.example.com', {
      skipCleanup: false,
    })

    vi.mocked(saasApi.deleteHostname).mockClear()
    vi.mocked(confirmDeleteWithSkipCleanup).mockResolvedValue({ confirmed: true, checked: true })
    wrapper.findComponent(SaasHostsTable).vm.$emit('remove', HOST)
    await flush()
    expect(saasApi.deleteHostname).toHaveBeenCalledWith('provider-1', 'example.com', 'api.example.com', {
      skipCleanup: true,
    })
  })

  it('取消删除：不下发任何删除请求', async () => {
    const wrapper = await mountPanel()
    vi.mocked(confirmDeleteWithSkipCleanup).mockResolvedValue({ confirmed: false, checked: true })

    wrapper.findComponent(SaasHostsTable).vm.$emit('remove', HOST)
    await flush()

    expect(saasApi.deleteHostname).not.toHaveBeenCalled()
  })
})

/**
 * query.data 是 TanStack 的深 readonly 代理，镜像进本地 ref 时必须浅拷贝：
 * 否则「用详情返回的新行替换列表中的同一行」会静默失效——Vue 只打 readonly 警告，
 * 行数据不更新，界面停在旧值。
 */
describe('SaasHostsPanel 列表镜像的就地替换', () => {
  it('详情返回的新行就地替换同一行：旧值必须消失，新值必须渲染', async () => {
    vi.mocked(saasApi.hostname).mockResolvedValue(ok({ ...HOST, custom_origin_server: 'origin-2.example.net' }))
    const wrapper = await mountPanel()

    expect(wrapper.findComponent(SaasHostsTable).text()).toContain('默认回源')

    wrapper.findComponent(SaasHostsTable).vm.$emit('detail', HOST)
    await flush()

    expect(wrapper.findComponent(SaasHostsTable).text()).toContain('origin-2.example.net')
  })
})
