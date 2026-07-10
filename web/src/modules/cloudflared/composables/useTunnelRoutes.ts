import { ref, computed } from 'vue'
import { cloudflaredApi } from '../utils/api'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'
import type { CloudflaredRoute, Zone } from '@/types'

export function useTunnelRoutes(
  props: { provider: string; tunnelId: string },
  contextTask: { next: () => number; current: () => number; isCurrent: (value: number) => boolean }
) {
  const config = ref<{ routes: CloudflaredRoute[] } | null>(null)
  const zones = ref<Zone[]>([])
  const routesError = ref('')
  const zonesError = ref('')
  const loadingConfig = ref(false)
  const savingRoute = ref(false)
  const showRouteForm = ref(false)
  const editingRoute = ref<CloudflaredRoute | null>(null)

  const routes = computed(() => config.value?.routes || [])

  const routeColumns = computed(() => [
    { title: '公共主机名', dataIndex: 'hostname', key: 'hostname', width: 240 },
    { title: '服务', dataIndex: 'service', key: 'service', width: 240 },
    { title: '路径', key: 'path', width: 120 },
    { title: '操作', key: 'actions', width: 130, align: 'right' },
  ])

  async function loadRoutes(currentToken = contextTask.current()) {
    loadingConfig.value = true
    try {
      const response = await cloudflaredApi.routes(props.provider, props.tunnelId)
      if (!contextTask.isCurrent(currentToken)) return
      config.value = response.data || null
      routesError.value = ''
    } catch (error) {
      if (!contextTask.isCurrent(currentToken)) return
      routesError.value = (error as Error).message || '无法加载路由配置'
    } finally {
      if (contextTask.isCurrent(currentToken)) loadingConfig.value = false
    }
  }

  async function loadZones(currentToken = contextTask.current()) {
    try {
      const response = await cloudflaredApi.zones(props.provider)
      if (!contextTask.isCurrent(currentToken)) return
      zones.value = response.data
      zonesError.value = ''
    } catch (error) {
      if (!contextTask.isCurrent(currentToken)) return
      zonesError.value = (error as Error).message || '无法加载 Cloudflare 站点列表'
    }
  }

  function openAddRoute() {
    editingRoute.value = null
    showRouteForm.value = true
  }

  function openEditRoute(route: CloudflaredRoute) {
    editingRoute.value = { ...route }
    showRouteForm.value = true
  }

  function routeRowKey(record: CloudflaredRoute) {
    return String(record.hostname || '') + String(record.path || '')
  }

  function notifyDnsOperation(operation: { status?: string; message?: string } | undefined, successFallback: string) {
    if (!operation) {
      message.success(successFallback)
      return
    }

    const text = operation.message || successFallback
    if (operation.status === 'failed') {
      message.warning(text)
      return
    }
    if (operation.status === 'skipped') {
      message.warning(text)
      return
    }

    message.success(text)
  }

  async function saveRoute(form: Record<string, unknown>) {
    const currentToken = contextTask.current()
    savingRoute.value = true
    try {
      let response = null
      if (editingRoute.value) {
        response = await cloudflaredApi.updateRoute(
          props.provider,
          props.tunnelId,
          form,
          editingRoute.value.hostname || '',
          editingRoute.value.path || ''
        )
        if (!contextTask.isCurrent(currentToken)) return
        notifyDnsOperation(response.side_effects?.dns?.sync, '路由已更新')
      } else {
        response = await cloudflaredApi.addRoute(props.provider, props.tunnelId, form)
        if (!contextTask.isCurrent(currentToken)) return
        notifyDnsOperation(response.side_effects?.dns?.sync, '路由已添加')
      }
      showRouteForm.value = false
      editingRoute.value = null
      await loadRoutes()
    } catch (error) {
      if (!contextTask.isCurrent(currentToken)) return
      message.error(errorMessage(error))
    } finally {
      if (contextTask.isCurrent(currentToken)) savingRoute.value = false
    }
  }

  function askDeleteRoute(route: CloudflaredRoute) {
    modal.confirm({
      title: '删除路由',
      content: `确认删除 ${route.hostname}${route.path ? ' (' + route.path + ')' : ''} 的路由？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => removeRoute(route),
    })
  }

  async function removeRoute(route: CloudflaredRoute) {
    const currentToken = contextTask.current()
    try {
      const zone = matchZone(route.hostname || '')
      const response = await cloudflaredApi.deleteRoute(
        props.provider,
        props.tunnelId,
        route.hostname || '',
        route.path || '',
        zone?.id || ''
      )
      if (!contextTask.isCurrent(currentToken)) return
      notifyDnsOperation(response.side_effects?.dns?.cleanup, '路由已删除')
      await loadRoutes()
    } catch (error) {
      if (!contextTask.isCurrent(currentToken)) return
      message.error(errorMessage(error))
    }
  }

  function matchZone(hostname: string) {
    const sorted = [...zones.value].sort((a, b) => String(b.name || '').length - String(a.name || '').length)
    return sorted.find((zone) => hostname === zone.name || hostname.endsWith('.' + zone.name)) || null
  }

  return {
    config,
    zones,
    routes,
    routesError,
    zonesError,
    loadingConfig,
    savingRoute,
    showRouteForm,
    editingRoute,
    routeColumns,
    loadRoutes,
    loadZones,
    openAddRoute,
    openEditRoute,
    saveRoute,
    askDeleteRoute,
    removeRoute,
    matchZone,
    routeRowKey,
  }
}
