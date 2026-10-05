import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
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
