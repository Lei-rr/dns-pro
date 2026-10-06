import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { edgeOneApi } from '@/features/edge-one/api/edge-one-api'
import type { EdgeOneAccelerationDomain, EdgeOneZone } from '@/features/edge-one/model/types'
import {
  STATUS_POLL_FIRST_MS,
  STATUS_POLL_RATE_LIMIT_MAX_MS,
  STATUS_POLL_RATE_LIMIT_MIN_MS,
} from '@/features/edge-one/model/status-poll-policy'
import type { ApiResponse } from '@/shared/api/types'
import { confirmDeleteWithSkipCleanup } from '@/shared/ui/confirm'
import AccelerationDomainsPanel from './AccelerationDomainsPanel.vue'
import AccelerationDomainsTable from './AccelerationDomainsTable.vue'

/**
 * 面板轮询编排的组件级测试（引入 Vitest 的最终落点）：
 * 此前「页面不可见时不发请求」只在隔离脚本里验过工具函数与策略函数，组件里真实的编排（定时器、
 * 可见性门控、退避重排、卸载清理）从未被验证。断言口径：
 *  - 只在「下发 → 状态落定」之间轮询，页面静止时一个定时请求都不发；
 *  - 不设次数/时长上限（只放缓间隔，10s 封顶）；
 *  - 限流时改走 60s 起、翻倍、300s 封顶的退避，不按常规节奏继续打；
 *  - 不可见即停表，恢复可见立即补一次并继续起步节奏；
 *  - 卸载后定时器与可见性监听全部清除。
 *
 * 打法：只在 feature 的 API 层（edge-one-api 的具名方法）打桩，不 mock http 客户端，
 * 组件的真实调用路径（useResourceQuery → refreshSilently → accelerationDomains）保持不变；
 * 时间统一走假时钟，用 advanceTimersByTimeAsync 推进（TanStack 的通知经 setTimeout(0) 派发，
 * 必须走异步推进，否则微任务里排队的通知不会落地）。
 */

const ZONE_ID = 'zone-1'
const ZONE_NAME = '示例站点'
const DOMAIN_NAME = 'www.example.com'

// 删除确认弹窗由 shared/ui/confirm 的组件测试覆盖；这里只关心勾选结果如何转成接口参数
vi.mock('@/shared/ui/confirm', () => ({
  confirmDeleteWithSkipCleanup: vi.fn(),
  confirmDialog: vi.fn(),
}))

function ok<T>(data: T): ApiResponse<T> {
  return { code: 0, message: 'success', data }
}

/** 服务器视角的一条加速域名记录（本文件只关心状态字段的流转） */
function domainRecord(status: string): EdgeOneAccelerationDomain {
  return {
    domain_name: DOMAIN_NAME,
    status,
    active_status: status,
    cname: `${DOMAIN_NAME}.edgeone.site`,
    origin_type: 'IP',
  }
}

const ZONE: EdgeOneZone = { id: ZONE_ID, name: ZONE_NAME, status: 'online' }

/** 限流信号：与 status-poll-policy 识别的四种形态同构 */
function rateLimitError(details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error('请求过于频繁'), { code: 'provider_rate_limited', status: 429, details })
}

type PollCall = { at: number; refresh: boolean }

type FakeServer = {
  /** 下一次刷新时服务器返回的记录（测试中途改写即模拟状态流转） */
  records: EdgeOneAccelerationDomain[]
  /** 非空时刷新抛错（模拟限流/失败响应） */
  failure: unknown
  /** 每次 accelerationDomains 调用的时刻与是否带 refresh=1（含首次加载） */
  polls: PollCall[]
  /** 相邻两次调用的间隔；首个 0 已剔除 */
  gaps: () => number[]
  /** 让下一次刷新挂起在飞行中，直到 releasePendingPoll() —— 用于「一轮在飞时切换可见性」 */
  holdNextPoll: () => void
  releasePendingPoll: () => void
}

/** 在 API 层打桩：返回可改写的假服务器，并保持其余方法可用 */
function createFakeServer(): FakeServer {
  let holdNext = false
  let releasePending: (() => void) | null = null
  const server: FakeServer = {
    records: [domainRecord('online')],
    failure: null,
    polls: [],
    gaps: () => {
      const gaps: number[] = []
      let previous = server.polls[0]
      for (const call of server.polls.slice(1)) {
        if (previous) gaps.push(call.at - previous.at)
        previous = call
      }
      return gaps
    },
    holdNextPoll: () => {
      holdNext = true
    },
    releasePendingPoll: () => {
      const resolve = releasePending
      releasePending = null
      resolve?.()
    },
  }

  vi.spyOn(edgeOneApi, 'accelerationDomains').mockImplementation(async (_provider, _zone, options = {}) => {
    server.polls.push({ at: Date.now(), refresh: Boolean(options.refresh) })
    if (holdNext) {
      holdNext = false
      await new Promise<void>((resolve) => {
        releasePending = resolve
      })
    }
    if (server.failure) throw server.failure
    return ok(server.records.map((record) => ({ ...record })))
  })
  vi.spyOn(edgeOneApi, 'zones').mockImplementation(async () => ok<EdgeOneZone[]>([ZONE]))
  vi.spyOn(edgeOneApi, 'zone').mockImplementation(async () => ok<EdgeOneZone>(ZONE))
  vi.spyOn(edgeOneApi, 'updateAccelerationDomainStatus').mockImplementation(async () => ok(null))
  // onMounted 会探测活跃批量任务：这里返回「无任务」，避免任务轮询混进状态轮询的计时
  vi.spyOn(edgeOneApi, 'batchActive').mockImplementation(async () => ok(null))

  return server
}

/** 假时钟下放行一次：TanStack 的通知走 setTimeout(0)，Vue 的更新走微任务 */
async function flush() {
  await vi.advanceTimersByTimeAsync(0)
  await nextTick()
}

/** 推进时间并放行微任务 */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await nextTick()
}

const mountedWrappers: VueWrapper[] = []

/** 页面可见性替身：happy-dom 的 visibilityState 是 Document.prototype 上的 getter，改桩后派发事件即真实切换 */
function mockPageVisibility() {
  const spy = vi.spyOn(document, 'visibilityState', 'get')
  spy.mockReturnValue('visible')
  return (state: DocumentVisibilityState) => {
    spy.mockReturnValue(state)
    document.dispatchEvent(new Event('visibilitychange'))
  }
}

async function mountPanel() {
  const setVisibility = mockPageVisibility()
  const server = createFakeServer()
  const queryClient = new QueryClient({
    defaultOptions: {
      // retry=false 与生产 shared/query/client.ts 一致；staleTime/gcTime 取 Infinity 只为让
      // vi.getTimerCount() 只反映面板自己的轮询定时器：框架的「数据转陈旧」与「缓存回收」定时器
      // 都不发请求，留着它们会让「静止/卸载后无残留定时器」的计数无法精确断言。
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
    },
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })
  const wrapper = mount(AccelerationDomainsPanel, {
    attachTo: document.body,
    props: { providerId: 'provider-1', zoneId: ZONE_ID, dnspodLinked: false },
    global: { plugins: [router, [VueQueryPlugin, { queryClient }]] },
  })
  mountedWrappers.push(wrapper)
  await flush()
  // Vue 在 createApp 时挂一个 3s 的开发期 devtools 探测定时器（与轮询无关）：先放行它，
  // 之后 vi.getTimerCount() 才只反映面板自己的轮询定时器
  await advance(3000)
  return { wrapper, server, setVisibility }
}

function unmountPanel(wrapper: VueWrapper) {
  wrapper.unmount()
  const index = mountedWrappers.indexOf(wrapper)
  if (index >= 0) mountedWrappers.splice(index, 1)
}

/** 下发「停止加速」：走子表真实事件（点击 → emit 的链路已由 AccelerationDomainsTable.spec.ts 覆盖） */
async function sendStopCommand(wrapper: VueWrapper) {
  wrapper.findComponent(AccelerationDomainsTable).vm.$emit('stop', domainRecord('online'))
  await flush()
}

/** 行内菜单由 reka-ui 渲染到 body（Teleport）：happy-dom 下按键盘 Enter 打开，再点菜单项 */
async function openRowMenu(wrapper: VueWrapper) {
  await wrapper.get('[data-slot="dropdown-menu-trigger"]').trigger('keydown', { key: 'Enter' })
  await flush()
}

/**
 * 取菜单项：找不到就抛错。
 * 不能用「找不到返回 undefined」的取法——那会让「菜单项根本没渲染」也被可选链静默吞掉、断言照样通过。
 */
function getMenuItem(text: string): HTMLElement {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (element) => String(element.textContent ?? '').trim() === text
  )
  if (!item) throw new Error(`菜单项未渲染：${text}`)
  return item
}

function clickMenuItem(text: string) {
  getMenuItem(text).dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('AccelerationDomainsPanel 轮询编排 · 限定轮询时段', () => {
  it('页面静止（没有待落定指令）时不发任何定时请求，也不留定时器', async () => {
    const { server } = await mountPanel()

    expect(server.polls).toHaveLength(1)
    expect(server.polls[0]?.refresh).toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    await advance(30 * 60_000)

    expect(server.polls).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('下发后立即静默回源并开始轮询，状态落定后停止轮询（此后不再有新请求）', async () => {
    const { wrapper, server } = await mountPanel()
    await sendStopCommand(wrapper)

    // 首轮立即刷新，且必须绕过服务端缓存（refresh=1），否则 5 分钟缓存会让轮询白跑
    expect(server.polls).toHaveLength(2)
    expect(server.polls[1]?.refresh).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    // 上游进入过渡态：仍未落定，继续按 3s 起步节奏轮询
    server.records = [domainRecord('process')]
    await advance(STATUS_POLL_FIRST_MS)
    expect(server.polls).toHaveLength(3)
    expect(server.polls[2]?.refresh).toBe(true)

    // 落定为目标态：本轮之后立刻停表
    server.records = [domainRecord('offline')]
    await advance(4000)
    expect(server.polls).toHaveLength(4)
    expect(vi.getTimerCount()).toBe(0)

    await advance(30 * 60_000)
    expect(server.polls).toHaveLength(4)
  })

  it('未观察到 process 且状态仍是旧值时保持等待：不会提前收口（只多发一次的正常节奏内请求）', async () => {
    const { wrapper, server } = await mountPanel()
    await sendStopCommand(wrapper)

    // 服务器仍返回下发前的 online，但指令可能还没被上游接受：不能据此停止轮询
    await advance(STATUS_POLL_FIRST_MS)
    expect(server.polls).toHaveLength(3)
    expect(vi.getTimerCount()).toBe(1)

    await advance(4000)
    expect(server.polls).toHaveLength(4)
  })
})

describe('AccelerationDomainsPanel 过渡态不被静默刷新覆盖', () => {
  it('服务端仍返回 online 时行不回落：保持「配置中」且停止/删除入口保持禁用', async () => {
    const { wrapper, server } = await mountPanel()
    await sendStopCommand(wrapper)

    // 首轮静默回源时服务端还没接受指令，返回的仍是 online；行数据也不再被本地改写
    expect(server.records[0]?.status).toBe('online')
    expect(wrapper.findComponent(AccelerationDomainsTable).props('transitioningKeys')).toEqual([DOMAIN_NAME])

    // 展示层按过渡态渲染：徽章为「配置中」，状态入口锁住（否则用户会重复下发停止）
    expect(wrapper.text()).toContain('配置中')
    expect(wrapper.text()).not.toContain('已生效')
    await openRowMenu(wrapper)
    expect(getMenuItem('停止加速').getAttribute('data-disabled')).not.toBeNull()
    expect(getMenuItem('删除').getAttribute('data-disabled')).not.toBeNull()
    expect(document.body.textContent).toContain('配置中，暂不可操作')
  })

  it('状态落定后过渡态摘除：行回到服务端状态，启用与删除入口恢复可用', async () => {
    const { wrapper, server } = await mountPanel()
    await sendStopCommand(wrapper)
    expect(wrapper.findComponent(AccelerationDomainsTable).props('transitioningKeys')).toEqual([DOMAIN_NAME])

    // 上游落为 offline：下一次静默刷新里过渡态被摘除，行按服务端状态渲染
    server.records = [domainRecord('offline')]
    await advance(STATUS_POLL_FIRST_MS)

    expect(wrapper.findComponent(AccelerationDomainsTable).props('transitioningKeys')).toEqual([])
    expect(wrapper.text()).toContain('已停用')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('AccelerationDomainsPanel 删除时的 DNS 清理选择', () => {
  it('勾选「跳过 DNS 清理」→ deleteAccelerationDomain 收到 skipCleanup（对应后端 auto_cleanup=false）', async () => {
    const spy = vi.spyOn(edgeOneApi, 'deleteAccelerationDomain').mockResolvedValue(ok(null))
    vi.mocked(confirmDeleteWithSkipCleanup).mockResolvedValue({ confirmed: true, checked: true })
    const { wrapper } = await mountPanel()

    wrapper.findComponent(AccelerationDomainsTable).vm.$emit('remove', domainRecord('offline'))
    await flush()

    expect(spy).toHaveBeenCalledWith('provider-1', ZONE_ID, DOMAIN_NAME, { skipCleanup: true })
  })

  it('不勾选时保持既有行为 skipCleanup=false；取消则完全不发请求', async () => {
    const spy = vi.spyOn(edgeOneApi, 'deleteAccelerationDomain').mockResolvedValue(ok(null))
    const { wrapper } = await mountPanel()

    vi.mocked(confirmDeleteWithSkipCleanup).mockResolvedValue({ confirmed: true, checked: false })
    wrapper.findComponent(AccelerationDomainsTable).vm.$emit('remove', domainRecord('offline'))
    await flush()
    expect(spy).toHaveBeenCalledWith('provider-1', ZONE_ID, DOMAIN_NAME, { skipCleanup: false })

    spy.mockClear()
    vi.mocked(confirmDeleteWithSkipCleanup).mockResolvedValue({ confirmed: false, checked: true })
    wrapper.findComponent(AccelerationDomainsTable).vm.$emit('remove', domainRecord('offline'))
    await flush()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('AccelerationDomainsPanel 轮询编排 · 不设上限', () => {
  it('长时间未落定时持续轮询：间隔放缓到 10s 封顶，不会在某个次数或时长后停止', async () => {
    const { wrapper, server } = await mountPanel()
    await sendStopCommand(wrapper)
    server.records = [domainRecord('process')]

    await advance(10 * 60_000)

    // 10 分钟内约 64 次：任何「最多 N 次」的上限（10/20/30 次）都会在这里暴露
    const longRun = server.polls.length
    expect(longRun).toBeGreaterThan(60)
    // 间隔线性放缓后封顶在 10s：既不会再变长，也没有停止
    expect(server.gaps().slice(-5)).toEqual([10_000, 10_000, 10_000, 10_000, 10_000])
    expect(Math.max(...server.gaps())).toBe(10_000)

    await advance(60_000)
    expect(server.polls.length).toBe(longRun + 6)
  })
})

describe('AccelerationDomainsPanel 轮询编排 · 限流退避', () => {
  const RATE_LIMIT_CASES: Array<{ label: string; error: Error }> = [
    { label: 'HTTP 429', error: Object.assign(new Error('限流'), { status: 429 }) },
    { label: 'provider_rate_limited', error: rateLimitError() },
    {
      label: 'upstream_status=429',
      error: Object.assign(new Error('限流'), {
        code: 'edgeone_request_failed',
        status: 502,
        details: { upstream_status: 429 },
      }),
    },
    {
      label: '腾讯云业务限流码 RequestLimitExceeded',
      error: Object.assign(new Error('限流'), {
        code: 'edgeone_request_failed',
        status: 502,
        details: { code: 'RequestLimitExceeded' },
      }),
    },
  ]

  it.each(RATE_LIMIT_CASES)('$label 触发退避重排：下一轮从 60s 起，而不是 3s 常规节奏', async ({ error }) => {
    const { wrapper, server } = await mountPanel()
    await sendStopCommand(wrapper)

    server.failure = error
    await advance(STATUS_POLL_FIRST_MS)
    expect(server.polls).toHaveLength(3)

    // 常规节奏本应在 4s 后继续打；退避必须把下一轮推迟到 60s
    await advance(STATUS_POLL_RATE_LIMIT_MIN_MS - 1)
    expect(server.polls).toHaveLength(3)

    await advance(1)
    expect(server.polls).toHaveLength(4)
    expect(server.gaps().slice(-2)).toEqual([STATUS_POLL_FIRST_MS, STATUS_POLL_RATE_LIMIT_MIN_MS])
  })

  it('连续限流按 60s→120s→240s→300s 翻倍并封顶，成功刷新后回到常规节奏', async () => {
    const { wrapper, server } = await mountPanel()
    await sendStopCommand(wrapper)

    server.failure = rateLimitError()
    await advance(STATUS_POLL_FIRST_MS)
    expect(server.polls).toHaveLength(3)

    // 每一轮都仍在限流：退避翻倍并在 300s 封顶
    await advance(STATUS_POLL_RATE_LIMIT_MIN_MS)
    expect(server.polls).toHaveLength(4)
    await advance(120_000)
    expect(server.polls).toHaveLength(5)
    await advance(240_000)
    expect(server.polls).toHaveLength(6)
    await advance(STATUS_POLL_RATE_LIMIT_MAX_MS)
    expect(server.polls).toHaveLength(7)
    await advance(STATUS_POLL_RATE_LIMIT_MAX_MS)
    expect(server.polls).toHaveLength(8)

    expect(server.gaps().slice(-6)).toEqual([
      STATUS_POLL_FIRST_MS,
      STATUS_POLL_RATE_LIMIT_MIN_MS,
      120_000,
      240_000,
      STATUS_POLL_RATE_LIMIT_MAX_MS,
      STATUS_POLL_RATE_LIMIT_MAX_MS,
    ])

    // 限流解除：退避归零、回到起步节奏，并在落定后收口
    server.failure = null
    server.records = [domainRecord('offline')]
    await advance(STATUS_POLL_RATE_LIMIT_MAX_MS)
    expect(server.polls).toHaveLength(9)
    expect(server.gaps().at(-1)).toBe(STATUS_POLL_RATE_LIMIT_MAX_MS)

    await advance(30 * 60_000)
    expect(server.polls).toHaveLength(9)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('服务端明确给出更长等待时以服务端为准：不被 300s 封顶压制', async () => {
    const { wrapper, server } = await mountPanel()
    await sendStopCommand(wrapper)

    server.failure = rateLimitError({ retry_after_ms: 900_000 })
    await advance(STATUS_POLL_FIRST_MS)
    expect(server.polls).toHaveLength(3)

    await advance(900_000 - 1)
    expect(server.polls).toHaveLength(3)

    await advance(1)
    expect(server.polls).toHaveLength(4)
  })
})

describe('AccelerationDomainsPanel 轮询编排 · 可见性门控', () => {
  it('不可见时已有待落定指令也不发请求，恢复可见立即补一次并继续起步节奏', async () => {
    const { wrapper, server, setVisibility } = await mountPanel()
    await sendStopCommand(wrapper)
    expect(server.polls).toHaveLength(2)

    setVisibility('hidden')
    await flush()

    // 停表：不可见期间一个请求都不发
    expect(vi.getTimerCount()).toBe(0)
    await advance(30 * 60_000)
    expect(server.polls).toHaveLength(2)

    setVisibility('visible')
    await flush()

    // 立刻补一次静默回源（把不可见期间的变化拉回来），并按起步节奏继续
    expect(server.polls).toHaveLength(3)
    expect(server.polls[2]?.refresh).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    await advance(STATUS_POLL_FIRST_MS - 1)
    expect(server.polls).toHaveLength(3)
    await advance(1)
    expect(server.polls).toHaveLength(4)
  })

  it('不可见且没有待落定指令时恢复可见不会凭空开始轮询', async () => {
    const { server, setVisibility } = await mountPanel()

    setVisibility('hidden')
    await flush()
    setVisibility('visible')
    await flush()

    await advance(30 * 60_000)
    expect(server.polls).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('不可见时在飞的一轮结束后不再排下一轮，回到可见才补刷并接回节奏', async () => {
    const { wrapper, server, setVisibility } = await mountPanel()
    await sendStopCommand(wrapper)
    expect(server.polls).toHaveLength(2)

    // 让第 3 次请求停在飞行中，再切到不可见：此时定时器还没排出来
    server.holdNextPoll()
    await advance(STATUS_POLL_FIRST_MS)
    expect(server.polls).toHaveLength(3)

    setVisibility('hidden')
    await flush()

    server.releasePendingPoll()
    await flush()
    await flush()

    // 在飞的一轮结算后自行退出：不可见期间不再排下一轮
    expect(vi.getTimerCount()).toBe(0)
    await advance(30 * 60_000)
    expect(server.polls).toHaveLength(3)

    setVisibility('visible')
    await flush()
    expect(server.polls).toHaveLength(4)
    expect(vi.getTimerCount()).toBe(1)
  })
})

describe('AccelerationDomainsPanel 轮询编排 · 真实交互链路', () => {
  it('行内菜单「停止加速」→ 下发接口 → 立即开始轮询（模板绑定与编排接通）', async () => {
    const { wrapper, server } = await mountPanel()
    const updateStatus = vi.mocked(edgeOneApi.updateAccelerationDomainStatus)
    expect(updateStatus).not.toHaveBeenCalled()

    await openRowMenu(wrapper)
    clickMenuItem('停止加速')
    await flush()

    expect(updateStatus).toHaveBeenCalledWith('provider-1', ZONE_ID, DOMAIN_NAME, 'offline')
    expect(server.polls).toHaveLength(2)
    expect(server.polls[1]?.refresh).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    await advance(STATUS_POLL_FIRST_MS)
    expect(server.polls).toHaveLength(3)
  })
})

describe('AccelerationDomainsPanel 轮询编排 · 卸载清理', () => {
  it('卸载后定时器与可见性监听全部清除：推进假时钟不再产生请求', async () => {
    const addListener = vi.spyOn(document, 'addEventListener')
    const removeListener = vi.spyOn(document, 'removeEventListener')
    const { wrapper, server, setVisibility } = await mountPanel()
    await sendStopCommand(wrapper)
    expect(server.polls).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(1)

    const registered = addListener.mock.calls
      .filter(([type]) => type === 'visibilitychange')
      .map(([, listener]) => listener)
    expect(registered.length).toBeGreaterThan(0)

    unmountPanel(wrapper)

    // 定时器清干净：再推进一个起步周期也不会触发请求
    await advance(STATUS_POLL_FIRST_MS)
    expect(server.polls).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)

    // 可见性监听清干净：卸载后再派发可见性变化不会重启轮询
    setVisibility('hidden')
    setVisibility('visible')
    await advance(30 * 60_000)

    expect(server.polls).toHaveLength(2)
    const removed = removeListener.mock.calls
      .filter(([type]) => type === 'visibilitychange')
      .map(([, listener]) => listener)
    for (const listener of registered) expect(removed).toContain(listener)
  })
})
