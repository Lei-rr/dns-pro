#!/usr/bin/env node
// useResourceQuery 读路径原语：显式刷新语义 / 失败不误报 / 分页大小本地记忆
import assert from 'node:assert/strict'
import { createApp, effectScope, nextTick, type EffectScope } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { useResourceQuery } from '../web/src/shared/query/use-resource-query.js'
import { toast } from '../web/src/shared/lib/toast.js'

const storage = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
  },
})

const successNotices: string[] = []
const errorNotices: string[] = []
toast.success = ((title: string) => {
  successNotices.push(title)
}) as typeof toast.success
toast.error = ((title: string) => {
  errorNotices.push(title)
}) as typeof toast.error

async function waitFor(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(message)
}

type QueryContext = { refresh: boolean; signal: AbortSignal }
type Page = { items: string[] }

const calls: QueryContext[] = []
let mode: 'ok' | 'fail' = 'ok'
let hold = false
let releaseHold: (() => void) | null = null

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
})
const app = createApp({ render: () => null })
app.use(VueQueryPlugin, { queryClient })

/** 组合式函数必须在 effect scope 内建立，onScopeDispose 才能真正注册 */
function useInScope<T>(scope: EffectScope, factory: () => T): T {
  const value = scope.run(() => app.runWithContext(factory))
  assert.ok(value !== undefined, 'useResourceQuery 未返回实例')
  return value as T
}

const resourceScope = effectScope()
const resource = useInScope(resourceScope, () =>
  useResourceQuery<Page>({
    key: () => ['probe', 'resource'],
    queryFn: async (context) => {
      calls.push(context)
      if (hold) {
        hold = false
        await new Promise<void>((resolve) => {
          releaseHold = resolve
        })
      }
      if (mode === 'fail') throw new Error('probe resource failure')
      return { items: ['a'] }
    },
    pageSizeScope: 'probe-resource',
    refreshNotice: '已刷新',
  })
)

// 初次读取：不带 refresh，且必须拿到 TanStack 的取消信号
await waitFor(() => calls.length === 1, '初次读取未触发 queryFn')
assert.equal(calls[0]?.refresh, false, '初次读取不得下发 refresh=true')
assert.ok(calls[0]?.signal instanceof AbortSignal, 'queryFn 必须收到取消信号')
await waitFor(() => resource.data.value !== undefined, '初次读取未落地数据')

// refresh()：queryFn 必须看到 { refresh: true }，并在节流窗口后给出成功提示
successNotices.length = 0
const refreshStarted = Date.now()
await resource.refresh()
const refreshElapsed = Date.now() - refreshStarted
assert.equal(calls.length, 2, 'refresh() 必须重新触发 queryFn')
assert.equal(calls[1]?.refresh, true, 'refresh() 期间 queryFn 必须收到 { refresh: true }')
assert.deepEqual(successNotices, ['已刷新'], 'refresh() 成功后必须给出刷新提示')
assert.ok(refreshElapsed >= 110, `refresh() 必须节流到 REFRESH_MIN_MS，实际 ${refreshElapsed}ms`)

// 在飞期间的重复 refresh 必须被吞掉，不能放大成两次上游请求
successNotices.length = 0
hold = true
const pendingRefresh = resource.refresh()
await waitFor(() => calls.length === 3, 'refresh() 未触发 queryFn')
assert.equal(resource.refreshing.value, true, 'refresh 期间 refreshing 必须为 true')
const duplicateRefresh = resource.refresh()
assert.equal(calls.length, 3, '并发 refresh() 不得重复请求')
releaseHold?.()
await Promise.all([pendingRefresh, duplicateRefresh])
assert.equal(calls.length, 3, '重复 refresh() 不得重复请求')
assert.equal(resource.refreshing.value, false, 'refresh 结束后必须复位 refreshing')
assert.deepEqual(successNotices, ['已刷新'])

// 失败不得误报成功：失败时既没有成功提示，也要把错误即时反馈一次
successNotices.length = 0
errorNotices.length = 0
mode = 'fail'
await resource.refresh()
await waitFor(() => errorNotices.length >= 1, '读取失败必须即时反馈一次错误')
await nextTick()
assert.deepEqual(successNotices, [], '读取失败不得出现「已刷新」这类成功提示')
assert.equal(calls.at(-1)?.refresh, true)

// refreshNotice 为空串时静默
mode = 'ok'
const silentScope = effectScope()
const silent = useInScope(silentScope, () =>
  useResourceQuery<Page>({
    key: () => ['probe', 'silent'],
    queryFn: async () => ({ items: [] }),
    pageSizeScope: 'probe-silent',
    refreshNotice: '',
  })
)
await waitFor(() => silent.data.value !== undefined, '静默实例未完成初次读取')
successNotices.length = 0
await silent.refresh()
assert.deepEqual(successNotices, [], 'refreshNotice 为空串时不得弹出任何提示')

// setPageSize 落 localStorage，并能被同 scope 的新实例回读
resource.setPageSize(50)
assert.equal(resource.pageSize.value, 50)
assert.equal(storage.get('dns-pro:page-size:probe-resource'), '50', 'setPageSize 必须写入 localStorage')
resource.setPageSize(7)
assert.equal(storage.get('dns-pro:page-size:probe-resource'), '50', '非白名单分页大小不得落盘')

const reloadedScope = effectScope()
const reloaded = useInScope(reloadedScope, () =>
  useResourceQuery<Page>({
    key: () => ['probe', 'reloaded'],
    queryFn: async () => ({ items: [] }),
    pageSizeScope: 'probe-resource',
  })
)
assert.equal(reloaded.pageSize.value, 50, 'pageSize 必须从 localStorage 回读')

resourceScope.stop()
silentScope.stop()
reloadedScope.stop()

console.log(
  'resource-query-probe=ok refresh=flag-during-refetch failure=no-false-success notice=silent-on-empty page-size=localStorage'
)
