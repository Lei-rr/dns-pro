import { onUnmounted, reactive, ref, watch } from 'vue'
import { tunnelApi, type TunnelRouteInput } from '@/features/tunnels/api/tunnel-api'
import type { TunnelRoute } from '@/features/tunnels/model/types'
import { confirmDelete } from '@/shared/ui/confirm'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { serverFieldErrors } from '@/shared/lib/field-errors'
import { useRowBusy } from '@/shared/lib/row-busy'
import { createScopeGeneration } from '@/shared/lib/scope-generation'
import { routeKey } from '@/features/tunnels/lib/route-key'
import type { TunnelDetailScope } from './use-tunnel-detail'

/** 隧道 Ingress 路由的增删改：表单状态、逐行 busy 与作用域失效 */
export function useTunnelRoutes(props: TunnelDetailScope, invalidateDetail: () => Promise<void>) {
  const mutationGeneration = createScopeGeneration()
  const { isBusy, runBusy, reset: resetRowOperations } = useRowBusy()
  const saving = ref(false)
  const dialogOpen = ref(false)
  const editingRoute = ref<TunnelRoute | null>(null)
  const routeErrors = ref<Record<string, string>>({})
  const form = reactive({
    hostname: '',
    service: 'http://localhost:8080',
    path: '',
  })

  /** hostname + path 唯一确定一条 ingress 规则，行 key 与 busy key 共用此口径（见 lib/route-key） */
  const isRouteBusy = (record: TunnelRoute) => isBusy(routeKey(record))

  function openCreate() {
    editingRoute.value = null
    form.hostname = ''
    form.service = 'http://localhost:8080'
    form.path = ''
    routeErrors.value = {}
    dialogOpen.value = true
  }

  function openEditRoute(record: TunnelRoute) {
    editingRoute.value = record
    form.hostname = record.hostname
    form.service = record.service || 'http://localhost:8080'
    form.path = record.path
    routeErrors.value = {}
    dialogOpen.value = true
  }

  async function saveRoute() {
    if (saving.value) return
    const owner = mutationGeneration.capture({})
    routeErrors.value = {}
    if (!form.hostname.trim()) routeErrors.value.hostname = '请填写 Hostname'
    if (!form.service.trim()) routeErrors.value.service = '请填写 Service'
    if (Object.keys(routeErrors.value).length) return
    saving.value = true
    try {
      const data: TunnelRouteInput = {
        hostname: form.hostname.trim(),
        service: form.service.trim(),
        path: form.path.trim() || undefined,
      }
      if (editingRoute.value) {
        const response = await tunnelApi.updateRoute(
          props.providerId,
          props.tunnelId,
          data,
          editingRoute.value.hostname,
          editingRoute.value.path
        )
        if (!owner.active()) return
        notifyDnsSideEffect(response.data?.side_effects?.dns?.sync, '路由已更新')
      } else {
        const response = await tunnelApi.addRoute(props.providerId, props.tunnelId, data)
        if (!owner.active()) return
        notifyDnsSideEffect(response.data?.side_effects?.dns?.sync, '路由已添加')
      }
      dialogOpen.value = false
      await invalidateDetail()
    } catch (error) {
      if (!owner.active()) return
      routeErrors.value = { ...routeErrors.value, ...serverFieldErrors(error) }
      toast.error(errorMessage(error))
    } finally {
      if (owner.active()) saving.value = false
    }
  }

  async function removeRoute(record: TunnelRoute) {
    const scopeOwner = mutationGeneration.capture({})
    const providerId = props.providerId
    const tunnelId = props.tunnelId
    const hostname = record.hostname
    const path = record.path
    if (!(await confirmDelete(hostname)) || !scopeOwner.active()) return
    const key = routeKey(record)
    await runBusy(key, async (owner) => {
      if (!scopeOwner.active()) return
      try {
        const response = await tunnelApi.deleteRoute(providerId, tunnelId, hostname, path)
        if (!scopeOwner.active() || !owner.active()) return
        notifyDnsSideEffect(response.data?.side_effects?.dns?.cleanup, '已删除')
        await invalidateDetail()
      } catch (error) {
        if (scopeOwner.active() && owner.active()) toast.error(errorMessage(error))
      }
    })
  }

  watch(
    () => [props.providerId, props.tunnelId],
    () => {
      mutationGeneration.invalidate()
      resetRowOperations()
      dialogOpen.value = false
      editingRoute.value = null
      saving.value = false
    }
  )

  onUnmounted(() => {
    mutationGeneration.invalidate()
    resetRowOperations()
  })

  return {
    saving,
    dialogOpen,
    editingRoute,
    routeErrors,
    form,
    isRouteBusy,
    openCreate,
    openEditRoute,
    saveRoute,
    removeRoute,
  }
}
