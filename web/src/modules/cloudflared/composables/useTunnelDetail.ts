import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { cloudflaredApi } from '../utils/api'
import { statusLabel, statusColor } from '../utils/format'
import { providerPath } from '@/routes/paths'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'
import type { CloudflaredTunnel } from '@/types'

const REFRESH_INTERVAL_MS = 3000

export function useTunnelDetail(
  props: { provider: string; tunnelId: string },
  contextTask: { next: () => number; current: () => number; isCurrent: (value: number) => boolean; cancel: () => void }
) {
  const router = useRouter()

  const tunnel = ref<CloudflaredTunnel | null>(null)
  const token = ref('')
  const tokenError = ref('')
  const loading = ref(true)
  const rotating = ref(false)
  const activeTab = ref('overview')
  let pollingTimer: ReturnType<typeof setInterval> | null = null

  const backPath = computed(() => providerPath(props.provider))
  const tunnelName = computed(() => tunnel.value?.name || '')
  const tunnelStatus = computed(() => tunnel.value?.status || 'inactive')
  const isConnected = computed(() => tunnelStatus.value === 'healthy' || tunnelStatus.value === 'degraded')
  const replicaCount = computed(
    () => ((tunnel.value?.connections || []).filter((c) => !c.is_pending_reconnect)).length
  )
  const uptime = computed(() => {
    const active = tunnel.value?.conns_active_at
    if (!active) return '-'
    const ms = Date.now() - new Date(active).getTime()
    if (ms < 0) return '-'
    const hours = Math.floor(ms / 3600000)
    const minutes = Math.floor((ms % 3600000) / 60000)
    if (hours > 24) return `${Math.floor(hours / 24)}天 ${hours % 24}小时`
    if (hours > 0) return `${hours}小时 ${minutes}分`
    return `${minutes}分钟`
  })
  const connectionColumns = computed(() => [
    { title: '连接器 ID', dataIndex: 'client_id', key: 'client_id', width: 280 },
    { title: '版本', dataIndex: 'client_version', key: 'client_version', width: 120 },
    { title: '数据中心', dataIndex: 'colo_name', key: 'colo_name', width: 100 },
    { title: '来源 IP', dataIndex: 'origin_ip', key: 'origin_ip', width: 140 },
    { title: '连接时间', dataIndex: 'opened_at', key: 'opened_at', width: 180 },
  ])

  async function loadTunnel(currentToken = contextTask.current()) {
    try {
      const response = await cloudflaredApi.tunnel(props.provider, props.tunnelId, { refresh: true })
      if (!contextTask.isCurrent(currentToken)) return
      tunnel.value = response.data || null
      if (isConnected.value) {
        stopPolling()
      }
    } catch (error) {
      if (!contextTask.isCurrent(currentToken)) return
      message.error(errorMessage(error))
    }
  }

  async function loadToken(currentToken = contextTask.current()) {
    try {
      const response = await cloudflaredApi.tunnelToken(props.provider, props.tunnelId)
      if (!contextTask.isCurrent(currentToken)) return
      token.value = response.data?.token || ''
      tokenError.value = ''
    } catch (error) {
      if (!contextTask.isCurrent(currentToken)) return
      tokenError.value = (error as Error).message || '无法获取安装命令'
    }
  }

  function startPolling() {
    stopPolling()
    if (isConnected.value) return
    pollingTimer = setInterval(() => loadTunnel(contextTask.current()), REFRESH_INTERVAL_MS)
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  function askRotateToken() {
    modal.confirm({
      title: '轮换令牌',
      content: '轮换后当前令牌立即失效，所有已连接的副本会断开，需用新令牌重新安装/启动。确认轮换？',
      okText: '轮换',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => rotateToken(),
    })
  }

  async function rotateToken() {
    const currentToken = contextTask.current()
    rotating.value = true
    try {
      const response = await cloudflaredApi.rotateToken(props.provider, props.tunnelId)
      if (!contextTask.isCurrent(currentToken)) return
      token.value = response.data?.token || ''
      message.success('令牌已轮换，请用新令牌更新所有副本')
      startPolling()
    } catch (error) {
      if (!contextTask.isCurrent(currentToken)) return
      message.error(errorMessage(error))
    } finally {
      if (contextTask.isCurrent(currentToken)) rotating.value = false
    }
  }

  function connectionRowKey(record: { client_id?: string; id?: string }) {
    return String(record.id || record.client_id || '')
  }

  function formatDate(value: string | undefined) {
    if (!value) return '-'
    return new Date(value).toLocaleString('zh-CN')
  }

  async function loadAll(loaders: { loadRoutes?: () => Promise<void>; loadZones?: () => Promise<void> } = {}) {
    const currentToken = contextTask.next()
    stopPolling()
    loading.value = true
    try {
      await Promise.all([
        loadTunnel(currentToken),
        loadToken(currentToken),
        loaders.loadRoutes?.(),
        loaders.loadZones?.(),
      ])
      if (!contextTask.isCurrent(currentToken)) return
      startPolling()
    } finally {
      if (contextTask.isCurrent(currentToken)) loading.value = false
    }
  }

  function reloadContext(loaders: { loadRoutes?: () => Promise<void>; loadZones?: () => Promise<void> } = {}) {
    tunnel.value = null
    token.value = ''
    tokenError.value = ''
    return loadAll(loaders)
  }

  return {
    router,
    tunnel,
    token,
    tokenError,
    loading,
    rotating,
    activeTab,
    backPath,
    tunnelName,
    tunnelStatus,
    isConnected,
    replicaCount,
    uptime,
    connectionColumns,
    loadTunnel,
    loadToken,
    askRotateToken,
    rotateToken,
    startPolling,
    stopPolling,
    connectionRowKey,
    formatDate,
    loadAll,
    reloadContext,
    statusLabel,
    statusColor,
  }
}
