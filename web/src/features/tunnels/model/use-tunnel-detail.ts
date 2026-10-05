import { computed, onUnmounted, ref, watch } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { tunnelApi } from '@/features/tunnels/api/tunnel-api'
import type { Tunnel, TunnelRoute } from '@/features/tunnels/model/types'
import { useClipboardCopy } from '@/features/tunnels/lib/use-clipboard-copy'
import { useResourceQuery } from '@/shared/query'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { createScopeGeneration } from '@/shared/lib/scope-generation'

type TunnelDetail = { tunnel: Tunnel | null; routes: TunnelRoute[]; token: string; tokenFailed: boolean }

export interface TunnelDetailScope {
  providerId: string
  tunnelId: string
}

/**
 * 隧道详情读路径：三请求编排、token 复制/轮换与 CNAME 一键修复。
 * 修复与轮换各持独立 guard：共享 guard 的 claim 会作废在飞写入，让成功结果变成静默失败。
 */
export function useTunnelDetail(props: TunnelDetailScope) {
  const client = useQueryClient()
  const repairGeneration = createScopeGeneration()
  const rotationGeneration = createScopeGeneration()
  const repairing = ref(false)
  const rotating = ref(false)

  const detailKey = () => ['tunnels', 'detail', props.providerId, props.tunnelId]
  const detailQuery = useResourceQuery<TunnelDetail>({
    key: detailKey,
    queryFn: async ({ refresh, signal }) => {
      // 取 token 失败不清空已展示的 token：旧缓存兜底，轮换结果（setQueryData）也在此保留。
      // 失败转成 tokenFailed 标记而非抛错：详情整体仍算成功，由面板显式提示并可重试。
      const previous = client.getQueryData<TunnelDetail>(detailKey())
      const [tunnelRes, routesRes, tokenRes] = await Promise.all([
        tunnelApi.tunnel(props.providerId, props.tunnelId, { refresh, signal }),
        tunnelApi.routes(props.providerId, props.tunnelId, { refresh, signal }),
        tunnelApi.tunnelToken(props.providerId, props.tunnelId, { signal }).then(
          (response) => ({ token: response.data?.token || '', failed: false }),
          () => ({ token: '', failed: true })
        ),
      ])
      return {
        tunnel: tunnelRes.data,
        routes: routesRes.data?.routes || [],
        token: tokenRes.token || previous?.token || '',
        tokenFailed: tokenRes.failed,
      }
    },
    pageSizeScope: 'cloudflared-detail',
  })

  const tunnel = computed(() => detailQuery.data.value?.tunnel ?? null)
  const routes = computed(() => detailQuery.data.value?.routes ?? [])
  const token = computed(() => detailQuery.data.value?.token ?? '')
  const tokenFailed = computed(() => detailQuery.data.value?.tokenFailed ?? false)

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
        client.setQueryData<TunnelDetail>(detailKey(), (previous) =>
          previous ? { ...previous, token: nextToken } : previous
        )
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
    loading: detailQuery.loading,
    refreshing: detailQuery.refreshing,
    pageSize: detailQuery.pageSize,
    setPageSize: detailQuery.setPageSize,
    refresh: detailQuery.refresh,
    invalidate: detailQuery.invalidate,
    repairing,
    rotating,
    repairRoutes,
    rotateToken,
    isTokenCopied,
    copyToken,
  }
}
