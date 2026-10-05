import { computed, onUnmounted, ref, watch } from 'vue'
import { isCancelledError, useQueryClient } from '@tanstack/vue-query'
import { tunnelApi } from '@/features/tunnels/api/tunnel-api'
import type { Tunnel, TunnelRoute } from '@/features/tunnels/model/types'
import { useClipboardCopy } from '@/features/tunnels/lib/use-clipboard-copy'
import { useResourceQuery } from '@/shared/query'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { createScopeGeneration } from '@/shared/lib/scope-generation'

type TunnelDetail = { tunnel: Tunnel | null; routes: TunnelRoute[] }
type TunnelToken = { token: string; tokenFailed: boolean }

export interface TunnelDetailScope {
  providerId: string
  tunnelId: string
}

/**
 * 隧道详情读路径：详情聚合、token 读取/复制/轮换与 CNAME 一键修复。
 * 修复与轮换各持独立 guard：共享 guard 的 claim 会作废在飞写入，让成功结果变成静默失败。
 */
export function useTunnelDetail(props: TunnelDetailScope) {
  const client = useQueryClient()
  const repairGeneration = createScopeGeneration()
  const rotationGeneration = createScopeGeneration()
  const repairing = ref(false)
  const rotating = ref(false)

  const detailKey = () => ['tunnels', 'detail', props.providerId, props.tunnelId]
  const tokenKey = () => ['tunnels', 'token', props.providerId, props.tunnelId]

  const detailQuery = useResourceQuery<TunnelDetail>({
    key: detailKey,
    queryFn: async ({ refresh, signal }) => {
      const [tunnelRes, routesRes] = await Promise.all([
        tunnelApi.tunnel(props.providerId, props.tunnelId, { refresh, signal }),
        tunnelApi.routes(props.providerId, props.tunnelId, { refresh, signal }),
      ])
      return {
        tunnel: tunnelRes.data,
        routes: routesRes.data?.routes || [],
      }
    },
    pageSizeScope: 'cloudflared-detail',
  })

  /**
   * 安装令牌独立成 query key：详情聚合刷新与轮换不再争同一份缓存。
   * 保留聚合写法时，轮换的 setQueryData 会被并发的详情刷新整体覆盖（成功回调整体替换 state.data），
   * 缓存为空时 updater 返回 undefined 还会被整体丢弃——两种路径都会让界面停留在已失效的旧令牌上。
   */
  const tokenQuery = useResourceQuery<TunnelToken>({
    key: tokenKey,
    queryFn: async ({ signal }) => {
      // 读取失败保留已展示的旧令牌：卡片继续显示上次成功的值，由面板提示与「刷新」重试
      const previous = client.getQueryData<TunnelToken>(tokenKey())
      try {
        const response = await tunnelApi.tunnelToken(props.providerId, props.tunnelId, { signal })
        return { token: response.data?.token || '', tokenFailed: false }
      } catch (error) {
        // 轮换会先取消在飞的读取：取消不是读取失败，交回 TanStack 处理，避免误标 tokenFailed
        if (isCancelledError(error)) throw error
        return { token: previous?.token || '', tokenFailed: true }
      }
    },
    refreshNotice: '',
  })

  const tunnel = computed(() => detailQuery.data.value?.tunnel ?? null)
  const routes = computed(() => detailQuery.data.value?.routes ?? [])
  const token = computed(() => tokenQuery.data.value?.token ?? '')
  const tokenFailed = computed(() => tokenQuery.data.value?.tokenFailed ?? false)
  const loading = computed(() => detailQuery.loading.value || tokenQuery.loading.value)
  const refreshing = computed(() => detailQuery.refreshing.value || tokenQuery.refreshing.value)

  /** 刷新详情与令牌：tokenFailed 的提示依赖这里同时重试令牌读取 */
  async function refresh() {
    await Promise.all([detailQuery.refresh(), tokenQuery.refresh()])
  }

  /** 快赢能力（F5）：CNAME 丢失/漂移时一键修复，逐主机名结果由副作用摘要反馈 */
  async function repairRoutes() {
    if (repairing.value) return
    const owner = repairGeneration.claim({ providerId: props.providerId, tunnelId: props.tunnelId })
    repairing.value = true
    try {
      const response = await tunnelApi.repairRoutes(owner.value.providerId, owner.value.tunnelId)
      if (!owner.active()) return
      notifyDnsSideEffect(response.data?.side_effects?.dns?.sync, 'DNS 修复完成')
      await detailQuery.invalidate()
    } catch (error) {
      if (owner.active()) toast.error(errorMessage(error))
    } finally {
      if (owner.active()) repairing.value = false
    }
  }

  async function rotateToken() {
    if (rotating.value) return
    const owner = rotationGeneration.claim({ providerId: props.providerId, tunnelId: props.tunnelId })
    rotating.value = true
    try {
      const response = await tunnelApi.rotateToken(owner.value.providerId, owner.value.tunnelId)
      if (!owner.active()) return
      const nextToken = response.data?.token
      if (nextToken) {
        // 令牌的唯一权威来源是独立的 token query：
        // 先取消在飞的读取（旧令牌不得覆盖轮换结果），再把轮换响应写回该 key
        await client.cancelQueries({ queryKey: tokenKey() })
        client.setQueryData<TunnelToken>(tokenKey(), { token: nextToken, tokenFailed: false })
      }
      toast.success('Token 已轮换')
    } catch (error) {
      if (owner.active()) toast.error(errorMessage(error))
    } finally {
      if (owner.active()) rotating.value = false
    }
  }

  const { copied, copy } = useClipboardCopy()
  /** copied 的布尔标记即 token 的高亮状态 */
  const isTokenCopied = computed(() => copied.value === true)

  async function copyToken() {
    if (!token.value) return
    await copy(token.value, true, { success: 'Token 已复制', failure: '复制失败，请手动选择复制' })
  }

  watch(
    () => [props.providerId, props.tunnelId],
    () => {
      repairGeneration.invalidate()
      rotationGeneration.invalidate()
      repairing.value = false
      rotating.value = false
    }
  )

  onUnmounted(() => {
    repairGeneration.invalidate()
    rotationGeneration.invalidate()
  })

  return {
    tunnel,
    routes,
    token,
    tokenFailed,
    loading,
    refreshing,
    pageSize: detailQuery.pageSize,
    setPageSize: detailQuery.setPageSize,
    refresh,
    invalidate: detailQuery.invalidate,
    repairing,
    rotating,
    repairRoutes,
    rotateToken,
    isTokenCopied,
    copyToken,
  }
}
