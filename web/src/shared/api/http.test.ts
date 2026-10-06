import { afterEach, describe, expect, it, vi } from 'vitest'
import http, { unwrapItem, unwrapList } from '@/shared/api/http'
import { CANCELED_CODE, isCanceledError, TIMEOUT_CODE, TRANSPORT_ERROR_HINTS } from '@/shared/api/transport-errors'
import { errorMessage } from '@/shared/lib/errors'

/**
 * 超时与主动取消的区分。
 *
 * 两种中断都让 fetch 抛出一模一样的 AbortError，错误对象里没有「谁中断的」这一信息，
 * 判定只能来自 http.ts 发起 abort 时的记录值：下面的 fetch 桩对两种中断拒绝完全相同的错误，
 * 实现一旦退回按 error.name 猜，切页取消就会被判成超时，用例立即失败。
 */

function abortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

/** 只会被中断的 fetch 桩：不接受正常响应，被迫走中断分支 */
function abortingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) {
          reject(new Error('transport must hand an AbortSignal to fetch'))
          return
        }
        const abort = () => reject(abortError())
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      })
  )
}

/** 先捕获拒绝值再断言：定时器必须推进到中断发生之后 */
function capture(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((error: unknown) => error)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('网络层的中断分类', () => {
  it('内部超时 → TIMEOUT，文案是超时而不是取消', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', abortingFetch())

    const settled = capture(http.get('/slow', { timeout: 50 }))
    await vi.advanceTimersByTimeAsync(60)
    const error = await settled

    expect(error).toMatchObject({ code: TIMEOUT_CODE, status: 0, message: TRANSPORT_ERROR_HINTS[TIMEOUT_CODE] })
    expect(isCanceledError(error)).toBe(false)
    expect(errorMessage(error)).toBe(TRANSPORT_ERROR_HINTS[TIMEOUT_CODE])
  })

  it('外部 signal 取消 → CANCELED，尽管拒绝的是同一个 AbortError', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', abortingFetch())

    const settled = capture(http.get('/slow', { signal: controller.signal, timeout: 60_000 }))
    controller.abort()
    const error = await settled

    expect(error).toMatchObject({ code: CANCELED_CODE, status: 0, message: TRANSPORT_ERROR_HINTS[CANCELED_CODE] })
    expect(isCanceledError(error)).toBe(true)
    expect(errorMessage(error)).toBe(TRANSPORT_ERROR_HINTS[CANCELED_CODE])
  })

  it('调用前就已取消的 signal → CANCELED，不退化成网络错误', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', abortingFetch())

    const error = await capture(http.get('/slow', { signal: controller.signal }))

    expect(error).toMatchObject({ code: CANCELED_CODE, status: 0 })
    expect(isCanceledError(error)).toBe(true)
  })

  it('先取消后超时：语义由先到的中断决定，晚到的定时器不得改写', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    vi.stubGlobal('fetch', abortingFetch())

    const settled = capture(http.get('/slow', { signal: controller.signal, timeout: 50 }))
    await vi.advanceTimersByTimeAsync(10)
    controller.abort()
    await vi.advanceTimersByTimeAsync(200)

    expect(await settled).toMatchObject({ code: CANCELED_CODE })
  })

  it('先超时后取消：超时语义保持，用户仍看得见失败', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    vi.stubGlobal('fetch', abortingFetch())

    const settled = capture(http.get('/slow', { signal: controller.signal, timeout: 50 }))
    await vi.advanceTimersByTimeAsync(60)
    controller.abort()
    await vi.advanceTimersByTimeAsync(60)

    expect(await settled).toMatchObject({ code: TIMEOUT_CODE })
  })

  it('HTTP 错误响应保持后端码值，不被当成本地中断', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'zone_not_found', message: '域名不存在', details: { zone: 'x' } }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          })
      )
    )

    const error = await capture(http.get('/zones/x'))

    expect(error).toMatchObject({ code: 'zone_not_found', message: '域名不存在', status: 404 })
    expect(isCanceledError(error)).toBe(false)
    expect(errorMessage(error)).toBe('域名不存在')
  })

  it('正常响应不被打上中断标记', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 0, message: 'success', data: { ok: true } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    )

    await expect(http.get('/ok')).resolves.toMatchObject({ data: { ok: true } })
  })
})

/** JSON 成功信封桩：解包器用例只关心 body 形状 */
function jsonFetch(payload: unknown, status = 200) {
  return vi.fn(
    async () => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  )
}

function isHostnamePayload(value: unknown): value is { hostname: string } {
  return typeof value === 'object' && value !== null && 'hostname' in value && typeof value.hostname === 'string'
}

describe('成功响应的载荷形状', () => {
  it('204 空体：载荷如实为 null，不再构造 null as T', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 }))
    )
    await expect(http.delete('/providers/one')).resolves.toMatchObject({ code: 0, message: 'success', data: null })
  })

  it('信封缺少 data：同样归一为 null（成功但无载荷）', async () => {
    vi.stubGlobal('fetch', jsonFetch({ code: 0, message: 'success' }))
    await expect(http.get('/maybe')).resolves.toMatchObject({ data: null })
  })

  it('unwrapList：空体归一为空数组', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 }))
    )
    expect(unwrapList(await http.get('/items')).data).toEqual([])
  })

  it('unwrapList：{ items } 形状保留分页元数据', async () => {
    vi.stubGlobal(
      'fetch',
      jsonFetch({ code: 0, message: 'success', data: { items: [{ id: 'a' }], pagination: { total: 3 } } })
    )
    const response = unwrapList(await http.get('/items'))
    expect(response.data).toEqual([{ id: 'a' }])
    expect(response.meta).toMatchObject({ total: 3, count: 1 })
  })

  it('unwrapList：形状不认识时抛错，而不是把原响应断言成列表', async () => {
    vi.stubGlobal('fetch', jsonFetch({ code: 0, message: 'success', data: { hostname: 'a.example.com' } }))
    const response = await http.get('/items')
    expect(() => unwrapList(response)).toThrowError(/列表/)
  })

  it('unwrapItem：空体/异形响应抛错，不再把 [] 断言成单条记录透传', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 }))
    )
    const response = await http.get('/hostname')
    expect(() => unwrapItem(response, isHostnamePayload)).toThrowError(/详情/)
  })

  it('unwrapItem：守卫命中时返回载荷本身', () => {
    const response = unwrapItem({ code: 0, message: 'success', data: { hostname: 'a.example.com' } }, isHostnamePayload)
    expect(response.data).toEqual({ hostname: 'a.example.com' })
  })
})

describe('中断文案', () => {
  it('超时与取消各有独立文案，不再共用「请求超时或已取消」', () => {
    expect(TRANSPORT_ERROR_HINTS[TIMEOUT_CODE]).toContain('超时')
    expect(TRANSPORT_ERROR_HINTS[TIMEOUT_CODE]).not.toContain('取消')
    expect(TRANSPORT_ERROR_HINTS[CANCELED_CODE]).toContain('取消')
    expect(TRANSPORT_ERROR_HINTS[CANCELED_CODE]).not.toContain('超时')
  })

  it('取消错误的文案来自取消码，而不是落回「请求失败」兜底', () => {
    expect(errorMessage({ code: CANCELED_CODE, status: 0 })).toBe(TRANSPORT_ERROR_HINTS[CANCELED_CODE])
  })
})
