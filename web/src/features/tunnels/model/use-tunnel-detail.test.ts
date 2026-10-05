import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tunnelApi } from '@/features/tunnels/api/tunnel-api'
import type { Tunnel } from '@/features/tunnels/model/types'
import type { ApiResponse } from '@/shared/api/types'
import { useTunnelDetail } from './use-tunnel-detail'

/**
 * 安装令牌的所有权回归：
 * 令牌曾与详情聚合共用同一个 query（缓存为空时 setQueryData 的 updater 返回 undefined 会被整条丢弃、
 * 缓存在飞时详情刷新又会整体覆盖轮换结果），轮换成功后界面会停在已失效的旧令牌上。
 * 此处钉住：令牌是独立 key，轮换结果必然可见，且不被在飞读取覆盖。
 */

vi.mock('@/features/tunnels/api/tunnel-api', () => ({
  tunnelApi: {
    tunnel: vi.fn(),
    routes: vi.fn(),
    tunnelToken: vi.fn(),
    rotateToken: vi.fn(),
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

const TUNNEL: Tunnel = { id: 't1', name: 'tunnel-1', status: 'healthy', connections: [] }

let detail!: ReturnType<typeof useTunnelDetail>
let wrapper: VueWrapper | undefined

const Host = defineComponent({
  setup() {
    detail = useTunnelDetail({ providerId: 'provider-1', tunnelId: 't1' })
    return () => null
  },
})

async function flush() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

async function mountDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  })
  wrapper = mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } })
  await flush()
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.clearAllMocks()
})

describe('useTunnelDetail 令牌读写所有权', () => {
  it('详情缓存为空时轮换令牌：结果写入独立 key，且不被在飞读取覆盖', async () => {
    const firstLoad = deferred<ApiResponse<Tunnel>>()
    const pendingToken = deferred<ApiResponse<{ token: string }>>()
    vi.mocked(tunnelApi.tunnel).mockReturnValue(firstLoad.promise)
    vi.mocked(tunnelApi.routes).mockResolvedValue(ok({ routes: [] }))
    vi.mocked(tunnelApi.tunnelToken).mockReturnValue(pendingToken.promise)
    vi.mocked(tunnelApi.rotateToken).mockResolvedValue(ok({ token: 'rotated-token' }))

    await mountDetail()
    // 详情与令牌都还在飞：聚合缓存里没有任何可供 patch 的对象
    expect(detail.token.value).toBe('')

    await detail.rotateToken()
    expect(detail.token.value).toBe('rotated-token')

    // 在飞的旧读取随后返回：不得覆盖轮换结果
    pendingToken.resolve(ok({ token: 'stale-token' }))
    firstLoad.resolve(ok(TUNNEL))
    await flush()

    expect(detail.token.value).toBe('rotated-token')
  })

  it('令牌读取失败保留已展示的旧令牌并标记失败，刷新可恢复', async () => {
    vi.mocked(tunnelApi.tunnel).mockResolvedValue(ok(TUNNEL))
    vi.mocked(tunnelApi.routes).mockResolvedValue(ok({ routes: [] }))
    vi.mocked(tunnelApi.tunnelToken).mockResolvedValue(ok({ token: 'old-token' }))

    await mountDetail()
    expect(detail.token.value).toBe('old-token')
    expect(detail.tokenFailed.value).toBe(false)

    vi.mocked(tunnelApi.tunnelToken).mockRejectedValue(new Error('token failed'))
    await detail.refresh()
    expect(detail.tokenFailed.value).toBe(true)
    expect(detail.token.value).toBe('old-token')

    vi.mocked(tunnelApi.tunnelToken).mockResolvedValue(ok({ token: 'new-token' }))
    await detail.refresh()
    expect(detail.tokenFailed.value).toBe(false)
    expect(detail.token.value).toBe('new-token')
  })
})
