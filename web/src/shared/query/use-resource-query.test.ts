import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createApp, defineComponent, effectScope, nextTick, type EffectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CANCELED_CODE,
  TIMEOUT_CODE,
  TRANSPORT_ERROR_HINTS,
  type TransportErrorCode,
} from '@/shared/api/transport-errors'
import { toast } from '@/shared/lib/toast'
import { useResourceQuery } from './use-resource-query'

/**
 * 读路径的错误提示分流：取消不是错误。
 *
 * 切页 / 切换作用域会中断在飞请求，用户什么都没做，弹「请求已取消」（更早是「请求超时或已取消」）纯属噪音；
 * 超时是真实失败，仍然必须提示。两类中断在 transport 层已经分开，这里钉住消费侧的分流，
 * 且刻意让取消错误真的进入查询状态——静默必须来自判定，而不是来自「错误没送达」。
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

type Page = { items: string[] }

let failingCode: TransportErrorCode | null = null
let resource: ReturnType<typeof useResourceQuery<Page>> | undefined
let wrapper: VueWrapper | undefined

/** 与 http.ts 抛出的 RequestError 同形：码值取自同一份定义 */
function transportFailure(code: TransportErrorCode): Error {
  return Object.assign(new Error(TRANSPORT_ERROR_HINTS[code]), { code, status: 0 })
}

const Host = defineComponent({
  setup() {
    resource = useResourceQuery<Page>({
      key: () => ['cancel-silence'],
      queryFn: async () => {
        if (failingCode) throw transportFailure(failingCode)
        return { items: [] }
      },
    })
    return () => null
  },
})

async function flush() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

async function waitUntil(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await flush()
  }
  throw new Error(message)
}

async function mountQuery() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  })
  wrapper = mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } })
  await flush()
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  resource = undefined
  failingCode = null
  vi.clearAllMocks()
})

describe('useResourceQuery 的错误提示分流', () => {
  it('取消：错误已进入查询状态，但不弹任何提示', async () => {
    failingCode = CANCELED_CODE
    await mountQuery()

    await waitUntil(() => resource?.error.value !== undefined, '取消错误未进入查询状态')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('超时：照常提示一次，文案是超时', async () => {
    failingCode = TIMEOUT_CODE
    await mountQuery()

    await waitUntil(() => vi.mocked(toast.error).mock.calls.length > 0, '超时未提示')
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(TRANSPORT_ERROR_HINTS[TIMEOUT_CODE])
  })
})

/* ---------------------------------------------------------------------------
 * useResourceQuery 读路径原语：显式刷新语义 / 失败不误报 / 分页大小本地记忆
 * 迁移自 scripts/isolated-resource-query-probe.ts（探针已退役）。
 * ------------------------------------------------------------------------- */

type ProbePage = { items: string[] }
type ProbeQueryContext = { refresh: boolean; signal: AbortSignal }

/** 原探针的等待器：产品轮询按 10ms 轮询到 3s（refresh 节流 120ms，慢环境留足余量） */
async function waitForProbe(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

/** 每个用例独立的 QueryClient / app 上下文：不碰共享单例，避免用例互相污染 */
function createResourceProbe() {
  const calls: ProbeQueryContext[] = []
  let mode: 'ok' | 'fail' = 'ok'
  let holdNext = false
  const hold: { release: (() => void) | null } = { release: null }

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
  })
  const app = createApp({ render: () => null })
  app.use(VueQueryPlugin, { queryClient })

  async function probeQueryFn(context: ProbeQueryContext): Promise<ProbePage> {
    calls.push(context)
    if (holdNext) {
      holdNext = false
      await new Promise<void>((resolve) => {
        hold.release = resolve
      })
    }
    if (mode === 'fail') throw new Error('probe resource failure')
    return { items: ['a'] }
  }

  /** 组合式函数必须在 effect scope 内建立，onScopeDispose 才能真正注册 */
  function mountInScope<T>(scope: EffectScope, factory: () => T): T {
    const value = scope.run(() => app.runWithContext(factory))
    if (value === undefined) throw new Error('useResourceQuery 未返回实例')
    return value
  }

  function mountResource(
    scope: EffectScope,
    key: string,
    options: { pageSizeScope?: string; refreshNotice?: string } = {}
  ) {
    return mountInScope(scope, () =>
      useResourceQuery<ProbePage>({ key: () => ['vitest', 'resource-query', key], queryFn: probeQueryFn, ...options })
    )
  }

  return {
    calls,
    mountResource,
    failNextReads: () => {
      mode = 'fail'
    },
    recoverReads: () => {
      mode = 'ok'
    },
    holdNextRead: () => {
      holdNext = true
    },
    releaseHeldRead: () => {
      if (hold.release) hold.release()
    },
  }
}

describe('useResourceQuery 读路径原语', () => {
  it('初次读取 → refresh 节流 → 并发吞并 → 失败不误报 → 空提示静默', async () => {
    const probe = createResourceProbe()
    const scope = effectScope()
    const resource = probe.mountResource(scope, 'main', { pageSizeScope: 'probe-resource', refreshNotice: '已刷新' })

    // 初次读取：不带 refresh，且必须拿到 TanStack 的取消信号
    await waitForProbe(() => probe.calls.length === 1, '初次读取未触发 queryFn')
    expect(probe.calls[0]?.refresh).toBe(false)
    expect(probe.calls[0]?.signal).toBeInstanceOf(AbortSignal)
    await waitForProbe(() => resource.data.value !== undefined, '初次读取未落地数据')

    // refresh()：queryFn 必须看到 { refresh: true }，并在节流窗口后给出成功提示
    vi.mocked(toast.success).mockClear()
    const refreshStarted = Date.now()
    await resource.refresh()
    const refreshElapsed = Date.now() - refreshStarted
    expect(probe.calls).toHaveLength(2)
    expect(probe.calls[1]?.refresh).toBe(true)
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('已刷新')
    expect(refreshElapsed).toBeGreaterThanOrEqual(110)

    // 在飞期间的重复 refresh 必须被吞掉，不能放大成两次上游请求
    vi.mocked(toast.success).mockClear()
    probe.holdNextRead()
    const pendingRefresh = resource.refresh()
    await waitForProbe(() => probe.calls.length === 3, 'refresh() 未触发 queryFn')
    expect(resource.refreshing.value).toBe(true)
    const duplicateRefresh = resource.refresh()
    expect(probe.calls).toHaveLength(3)
    probe.releaseHeldRead()
    await Promise.all([pendingRefresh, duplicateRefresh])
    expect(probe.calls).toHaveLength(3)
    expect(resource.refreshing.value).toBe(false)
    expect(toast.success).toHaveBeenCalledTimes(1)

    // 失败不得误报成功：失败时既没有成功提示，也要把错误即时反馈一次
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    probe.failNextReads()
    await resource.refresh()
    await waitForProbe(() => vi.mocked(toast.error).mock.calls.length >= 1, '读取失败必须即时反馈一次错误')
    await nextTick()
    expect(toast.success).not.toHaveBeenCalled()
    expect(probe.calls[probe.calls.length - 1]?.refresh).toBe(true)
    probe.recoverReads()

    // refreshNotice 为空串时静默
    const silentScope = effectScope()
    const silent = probe.mountResource(silentScope, 'silent', { pageSizeScope: 'probe-silent', refreshNotice: '' })
    await waitForProbe(() => silent.data.value !== undefined, '静默实例未完成初次读取')
    vi.mocked(toast.success).mockClear()
    await silent.refresh()
    expect(toast.success).not.toHaveBeenCalled()

    silentScope.stop()
    scope.stop()
  })

  it('setPageSize：白名单外的值不落盘，同 scope 的新实例能回读已存值', async () => {
    localStorage.removeItem('dns-pro:page-size:probe-resource')
    const probe = createResourceProbe()
    const scope = effectScope()
    const resource = probe.mountResource(scope, 'paging', { pageSizeScope: 'probe-resource' })

    resource.setPageSize(50)
    expect(resource.pageSize.value).toBe(50)
    expect(localStorage.getItem('dns-pro:page-size:probe-resource')).toBe('50')

    resource.setPageSize(7)
    // 非白名单分页大小不得落盘
    expect(localStorage.getItem('dns-pro:page-size:probe-resource')).toBe('50')

    const reloadedScope = effectScope()
    const reloaded = probe.mountResource(reloadedScope, 'reloaded', { pageSizeScope: 'probe-resource' })
    expect(reloaded.pageSize.value).toBe(50)

    scope.stop()
    reloadedScope.stop()
    localStorage.removeItem('dns-pro:page-size:probe-resource')
  })
})
