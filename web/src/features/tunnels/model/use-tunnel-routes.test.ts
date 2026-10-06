import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick, reactive } from 'vue'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { tunnelApi } from '@/features/tunnels/api/tunnel-api'
import type { TunnelRoute } from '@/features/tunnels/model/types'
import type { ApiResponse } from '@/shared/api/types'
import { confirmDelete } from '@/shared/ui/confirm'
import { toast } from '@/shared/lib/toast'
import { useTunnelRoutes } from './use-tunnel-routes'

/**
 * 隧道 Ingress 路由的增删改：表单校验、逐行 busy 与作用域失效。
 * 断言口径：请求载荷（trim / path 归一为 undefined）、弹窗与 saving 状态、busy 行 key、
 * 以及 scope 切换后迟到响应不得改 UI / 弹 toast。
 */

vi.mock('@/features/tunnels/api/tunnel-api', () => ({
  tunnelApi: {
    addRoute: vi.fn(),
    updateRoute: vi.fn(),
    deleteRoute: vi.fn(),
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

vi.mock('@/shared/ui/confirm', () => ({
  confirmDelete: vi.fn(),
  confirmDialog: vi.fn(),
  confirmDeleteWithSkipCleanup: vi.fn(),
}))

function ok<T>(data: T): ApiResponse<T> {
  return { code: 0, message: 'success', data }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const RECORD: TunnelRoute = { hostname: 'api.example.com', service: 'http://srv:8080', path: '/v1' }

let routes!: ReturnType<typeof useTunnelRoutes>
let scope!: { providerId: string; tunnelId: string }
let invalidateDetail!: Mock<() => Promise<void>>
let wrapper: VueWrapper | undefined

const Host = defineComponent({
  setup() {
    routes = useTunnelRoutes(scope, invalidateDetail)
    return () => null
  },
})

async function flush() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function mountRoutes() {
  scope = reactive({ providerId: 'provider-1', tunnelId: 't1' })
  invalidateDetail = vi.fn().mockResolvedValue(undefined)
  wrapper = mount(Host)
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.clearAllMocks()
})

describe('useTunnelRoutes 表单会话', () => {
  it('openCreate 清空上一次编辑的输入', () => {
    mountRoutes()
    routes.openEditRoute({ hostname: 'old.example.com', service: 'http://old:80', path: '/old' })
    routes.form.hostname = 'mutated'

    routes.openCreate()

    expect(routes.dialogOpen.value).toBe(true)
    expect(routes.editingRoute.value).toBeNull()
    expect(routes.form).toEqual({ hostname: '', service: 'http://localhost:8080', path: '' })
  })

  it('openEditRoute 回填记录；service 为空时回退默认服务地址且不写回记录', () => {
    mountRoutes()
    const record: TunnelRoute = { hostname: 'api.example.com', service: '', path: '/v1' }
    routes.openEditRoute(record)

    expect(routes.dialogOpen.value).toBe(true)
    expect(routes.editingRoute.value).toEqual(record)
    expect(routes.form).toEqual({ hostname: 'api.example.com', service: 'http://localhost:8080', path: '/v1' })

    routes.openEditRoute({ hostname: 'root.example.com', service: 'http://10.0.0.1:9000', path: '' })
    expect(routes.form).toEqual({ hostname: 'root.example.com', service: 'http://10.0.0.1:9000', path: '' })
  })

  it('切换 provider / tunnel 时关闭弹窗、丢弃编辑对象并复位 saving', async () => {
    mountRoutes()
    routes.openEditRoute(RECORD)
    expect(routes.dialogOpen.value).toBe(true)

    scope.tunnelId = 't2'
    await nextTick()

    expect(routes.dialogOpen.value).toBe(false)
    expect(routes.editingRoute.value).toBeNull()
    expect(routes.saving.value).toBe(false)
  })
})

describe('useTunnelRoutes 保存', () => {
  it('hostname 与 service 都为空：逐字段报错且不发请求', async () => {
    mountRoutes()
    routes.openCreate()
    routes.form.hostname = '   '
    routes.form.service = ''

    await routes.saveRoute()

    expect(routes.routeErrors.value).toEqual({ hostname: '请填写 Hostname', service: '请填写 Service' })
    expect(tunnelApi.addRoute).not.toHaveBeenCalled()
    expect(routes.saving.value).toBe(false)
    expect(invalidateDetail).not.toHaveBeenCalled()
  })

  it('仅缺 service 时只报 service 错误', async () => {
    mountRoutes()
    routes.openCreate()
    routes.form.hostname = 'api.example.com'
    routes.form.service = '  '

    await routes.saveRoute()

    expect(routes.routeErrors.value).toEqual({ service: '请填写 Service' })
    expect(tunnelApi.addRoute).not.toHaveBeenCalled()
  })

  it('创建成功：trim 提交、path 空串归一为 undefined、关弹窗、刷新详情', async () => {
    mountRoutes()
    vi.mocked(tunnelApi.addRoute).mockResolvedValue(
      ok({ hostname: 'api.example.com', service: 'http://10.0.0.9:8080', path: '' })
    )
    routes.openCreate()
    routes.form.hostname = '  api.example.com '
    routes.form.service = ' http://10.0.0.9:8080 '
    routes.form.path = '   '

    await routes.saveRoute()

    const [providerArg, tunnelArg, payload] = vi.mocked(tunnelApi.addRoute).mock.calls[0] ?? []
    expect(providerArg).toBe('provider-1')
    expect(tunnelArg).toBe('t1')
    expect(payload).toEqual({ hostname: 'api.example.com', service: 'http://10.0.0.9:8080', path: undefined })
    expect(Object.keys(payload as object)).toContain('path')
    expect(routes.dialogOpen.value).toBe(false)
    expect(routes.saving.value).toBe(false)
    expect(invalidateDetail).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('路由已添加')
    expect(tunnelApi.updateRoute).not.toHaveBeenCalled()
  })

  it('编辑保存：携带原始 hostname/path 作为定位参数，path 非空原样提交', async () => {
    mountRoutes()
    vi.mocked(tunnelApi.updateRoute).mockResolvedValue(ok({ ...RECORD, hostname: 'new.example.com', path: '/v2' }))
    routes.openEditRoute(RECORD)
    routes.form.hostname = 'new.example.com'
    routes.form.service = ' http://srv:8080 '
    routes.form.path = '/v2'

    await routes.saveRoute()

    expect(vi.mocked(tunnelApi.updateRoute)).toHaveBeenCalledWith(
      'provider-1',
      't1',
      { hostname: 'new.example.com', service: 'http://srv:8080', path: '/v2' },
      'api.example.com',
      '/v1'
    )
    expect(toast.success).toHaveBeenCalledWith('路由已更新')
    expect(tunnelApi.addRoute).not.toHaveBeenCalled()
    expect(routes.dialogOpen.value).toBe(false)
    expect(invalidateDetail).toHaveBeenCalledTimes(1)
  })

  it('保存进行中再次提交被吞掉（saving 互斥）', async () => {
    mountRoutes()
    const pending = deferred<ApiResponse<TunnelRoute>>()
    vi.mocked(tunnelApi.addRoute).mockReturnValue(pending.promise)
    routes.openCreate()
    routes.form.hostname = 'api.example.com'

    const first = routes.saveRoute()
    expect(routes.saving.value).toBe(true)

    await routes.saveRoute()
    expect(tunnelApi.addRoute).toHaveBeenCalledTimes(1)

    pending.resolve(ok(RECORD))
    await first
    expect(routes.saving.value).toBe(false)
    expect(routes.dialogOpen.value).toBe(false)
  })

  it('保存失败：服务端字段错误并入表单、toast 后端文案、弹窗保留、saving 复位', async () => {
    mountRoutes()
    const error = Object.assign(new Error('保存失败'), {
      code: 'VALIDATION_FAILED',
      status: 422,
      details: { errors: { hostname: '域名已被占用' } },
    })
    vi.mocked(tunnelApi.addRoute).mockRejectedValue(error)
    routes.openCreate()
    routes.form.hostname = 'api.example.com'

    await routes.saveRoute()

    expect(routes.routeErrors.value).toEqual({ hostname: '域名已被占用' })
    expect(toast.error).toHaveBeenCalledWith('保存失败')
    expect(routes.dialogOpen.value).toBe(true)
    expect(routes.saving.value).toBe(false)
    expect(invalidateDetail).not.toHaveBeenCalled()
  })

  it('保存失败但服务端未给字段错误：routeErrors 保持为空，toast 用状态码兜底文案', async () => {
    mountRoutes()
    vi.mocked(tunnelApi.addRoute).mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'INTERNAL_ERROR', status: 500, details: {} })
    )
    routes.openCreate()
    routes.form.hostname = 'api.example.com'

    await routes.saveRoute()

    expect(routes.routeErrors.value).toEqual({})
    expect(toast.error).toHaveBeenCalledWith('服务暂时异常，请稍后重试')
  })

  it('保存响应迟到且 scope 已切换：不得关弹窗、不得刷新详情', async () => {
    mountRoutes()
    const pending = deferred<ApiResponse<TunnelRoute>>()
    vi.mocked(tunnelApi.addRoute).mockReturnValue(pending.promise)
    routes.openCreate()
    routes.form.hostname = 'api.example.com'

    const saving = routes.saveRoute()
    expect(routes.saving.value).toBe(true)

    scope.providerId = 'provider-2'
    await nextTick()
    expect(routes.dialogOpen.value).toBe(false)
    expect(routes.saving.value).toBe(false)

    pending.resolve(ok(RECORD))
    await saving

    expect(invalidateDetail).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(routes.dialogOpen.value).toBe(false)
  })

  it('编辑保存响应迟到且 scope 已切换：不得关弹窗、不得刷新详情', async () => {
    mountRoutes()
    const pending = deferred<ApiResponse<TunnelRoute>>()
    vi.mocked(tunnelApi.updateRoute).mockReturnValue(pending.promise)
    routes.openEditRoute(RECORD)
    routes.form.hostname = 'new.example.com'

    const saving = routes.saveRoute()
    expect(routes.saving.value).toBe(true)

    scope.tunnelId = 't2'
    await nextTick()

    pending.resolve(ok({ ...RECORD, hostname: 'new.example.com' }))
    await saving

    expect(invalidateDetail).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(routes.dialogOpen.value).toBe(false)
  })

  it('保存失败且 scope 已切换：不得弹 toast / 写表单错误', async () => {
    mountRoutes()
    const pending = deferred<ApiResponse<TunnelRoute>>()
    vi.mocked(tunnelApi.addRoute).mockReturnValue(pending.promise)
    routes.openCreate()
    routes.form.hostname = 'api.example.com'

    const saving = routes.saveRoute()
    scope.tunnelId = 't2'
    await nextTick()

    pending.reject(Object.assign(new Error('保存失败'), { details: { errors: { hostname: '域名已被占用' } } }))
    await saving

    expect(toast.error).not.toHaveBeenCalled()
    expect(routes.routeErrors.value).toEqual({})
  })
})

describe('useTunnelRoutes 删除', () => {
  it('确认弹窗取消：不发请求、不置忙', async () => {
    mountRoutes()
    vi.mocked(confirmDelete).mockResolvedValue(false)

    await routes.removeRoute(RECORD)

    expect(confirmDelete).toHaveBeenCalledWith('api.example.com')
    expect(tunnelApi.deleteRoute).not.toHaveBeenCalled()
    expect(routes.isRouteBusy(RECORD)).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('确认后删除：按 hostname/path 定位，期间仅该行 busy，成功后刷新详情', async () => {
    mountRoutes()
    vi.mocked(confirmDelete).mockResolvedValue(true)
    const pending = deferred<ApiResponse<TunnelRoute>>()
    vi.mocked(tunnelApi.deleteRoute).mockReturnValue(pending.promise)

    const removing = routes.removeRoute(RECORD)
    await flush()

    expect(routes.isRouteBusy(RECORD)).toBe(true)
    expect(routes.isRouteBusy({ ...RECORD, hostname: 'other.example.com' })).toBe(false)
    expect(routes.isRouteBusy({ ...RECORD, path: '/other' })).toBe(false)

    pending.resolve(ok(RECORD))
    await removing

    expect(vi.mocked(tunnelApi.deleteRoute)).toHaveBeenCalledWith('provider-1', 't1', 'api.example.com', '/v1')
    expect(routes.isRouteBusy(RECORD)).toBe(false)
    expect(invalidateDetail).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('已删除')
  })

  it('删除失败：toast 错误文案，忙标记释放，不刷新详情', async () => {
    mountRoutes()
    vi.mocked(confirmDelete).mockResolvedValue(true)
    vi.mocked(tunnelApi.deleteRoute).mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'NOT_FOUND', status: 404, details: {} })
    )

    await routes.removeRoute(RECORD)

    expect(toast.error).toHaveBeenCalledWith('资源不存在')
    expect(routes.isRouteBusy(RECORD)).toBe(false)
    expect(invalidateDetail).not.toHaveBeenCalled()
  })

  it('同一行删除进行中重复触发：第二次不再发请求（行级互斥）', async () => {
    mountRoutes()
    vi.mocked(confirmDelete).mockResolvedValue(true)
    const pending = deferred<ApiResponse<TunnelRoute>>()
    vi.mocked(tunnelApi.deleteRoute).mockReturnValue(pending.promise)

    const first = routes.removeRoute(RECORD)
    await flush()

    await routes.removeRoute(RECORD)
    expect(tunnelApi.deleteRoute).toHaveBeenCalledTimes(1)

    pending.resolve(ok(RECORD))
    await first
    expect(routes.isRouteBusy(RECORD)).toBe(false)
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('确认弹窗期间切换 scope：迟到的确认不得触发删除', async () => {
    mountRoutes()
    const confirmation = deferred<boolean>()
    vi.mocked(confirmDelete).mockReturnValue(confirmation.promise)

    const removing = routes.removeRoute(RECORD)
    scope.tunnelId = 't2'
    await nextTick()

    confirmation.resolve(true)
    await removing

    expect(tunnelApi.deleteRoute).not.toHaveBeenCalled()
    expect(routes.isRouteBusy(RECORD)).toBe(false)
  })

  it('删除请求在飞时切换 scope：迟到的成功响应不得 toast / 刷新', async () => {
    mountRoutes()
    vi.mocked(confirmDelete).mockResolvedValue(true)
    const pending = deferred<ApiResponse<TunnelRoute>>()
    vi.mocked(tunnelApi.deleteRoute).mockReturnValue(pending.promise)

    const removing = routes.removeRoute(RECORD)
    await flush()

    scope.providerId = 'provider-2'
    await nextTick()
    pending.resolve(ok(RECORD))
    await removing

    expect(toast.success).not.toHaveBeenCalled()
    expect(invalidateDetail).not.toHaveBeenCalled()
    expect(routes.isRouteBusy(RECORD)).toBe(false)
  })

  it('删除失败且 scope 已切换：不得弹错误 toast', async () => {
    mountRoutes()
    vi.mocked(confirmDelete).mockResolvedValue(true)
    const pending = deferred<ApiResponse<TunnelRoute>>()
    vi.mocked(tunnelApi.deleteRoute).mockReturnValue(pending.promise)

    const removing = routes.removeRoute(RECORD)
    await flush()

    scope.tunnelId = 't2'
    await nextTick()
    pending.reject(Object.assign(new Error('boom'), { code: 'NOT_FOUND', status: 404, details: {} }))
    await removing

    expect(toast.error).not.toHaveBeenCalled()
    expect(routes.isRouteBusy(RECORD)).toBe(false)
  })
})
