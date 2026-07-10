<template>
  <section>
    <ListToolbar back-text="返回站点" :title="decodedZoneName" subtitle="Cloudflare for SaaS 自定义主机名列表" @back="router.push(zonesPath)">
      <template #actions>
        <a-button :loading="loading" :disabled="creating || savingEdit || deleting" @click="handleRefresh">刷新</a-button>
        <a-button :disabled="notFound || creating || savingEdit || deleting" @click="openFallbackOrigin">默认回源</a-button>
        <a-button v-if="dnspodLinked" :disabled="creating || savingEdit || deleting" @click="openPreferredManager">优选域名</a-button>
        <a-button type="primary" :disabled="notFound || creating || savingEdit || deleting" @click="openCreate">新增主机名</a-button>
      </template>
    </ListToolbar>
    <BatchToolbar :count="selectedHostnames.length" :deleting="deleting" delete-text="批量删除" @delete="askBatchDelete" @clear="clearSelection" />
    <a-result v-if="notFound" status="404" title="站点不存在或不可访问" :sub-title="decodedZoneName">
      <template #extra><a-button type="primary" @click="router.push(zonesPath)">返回站点</a-button></template>
    </a-result>

    <a-table
      v-else
      :columns="columns"
      :data-source="hostnames"
      :row-key="record => record.id || record.hostname"
      :loading="loading"
      :pagination="pagination"
      :row-selection="{ selectedRowKeys: selectedHostnames.map(item => item.id || item.hostname), onChange: (_keys, rows) => selectedHostnames = rows }"
      size="middle"
      :scroll="{ x: 1000 }"
      :locale="{ emptyText: '暂无自定义主机名' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'hostname'">
          <a-space size="small">
            <a-avatar size="small" :style="{ background: hostnameAvatarColor() }">{{ hostnameAvatar(record.hostname) }}</a-avatar>
            <a @click="openDetails(record)">{{ record.hostname }}</a>
          </a-space>
        </template>
        <template v-else-if="column.key === 'ssl_status'">
          <a-tag :color="statusColor(record.ssl?.status)">{{ statusLabel(record.ssl?.status) }}</a-tag>
        </template>
        <template v-else-if="column.key === 'expires_on'">
          {{ formatDate(record.ssl?.expires_on) }}
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
        </template>
        <template v-else-if="column.key === 'custom_origin_server'">
          <div class="origin-cell">
            <a-tag v-if="!record.custom_origin_server" color="blue">默认回源</a-tag>
            <a-typography-text v-else :ellipsis="{ tooltip: record.custom_origin_server }" style="max-width: 140px; display: inline-block;">
              {{ record.custom_origin_server }}
            </a-typography-text>
          </div>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space size="small">
            <a-button type="link" size="small" :disabled="creating || savingEdit || deleting" @click="openDetails(record)">详情</a-button>
            <a-dropdown>
              <a-button type="link" size="small" :disabled="creating || savingEdit || deleting">更多</a-button>
              <template #overlay>
                  <a-menu>
                    <a-menu-item @click="openEdit(record)">编辑</a-menu-item>
                    <a-menu-item danger @click="askDelete(record)">删除</a-menu-item>
                  </a-menu>
              </template>
            </a-dropdown>
          </a-space>
        </template>
      </template>
    </a-table>

    <SaasCreateModal
      :open="showCreateForm"
      :title="editingHostname ? '编辑自定义主机名' : '新增自定义主机名'"
      :ok-text="editingHostname ? '保存' : '创建'"
      :confirm-loading="editingHostname ? savingEdit : creating"
      :dnspod-linked="dnspodLinked"
      :cloudflare-dns-linked="cloudflareDnsLinked"
      :dnspod-providers="dnspodProviders"
      :cloudflare-dns-providers="cloudflareProviders"
      :dnspod-zones="dnspodZones"
      :cloudflare-dns-zones="cloudflareDnsZones"
      :origin-suggestions="originSuggestions"
      :preferred-domains="preferredDomains"
      :initial-value="editingHostname"
      :editing="!!editingHostname"
      @update:open="value => { showCreateForm = value; if (!value) editingHostname = null }"
      @submit="editingHostname ? update($event) : create($event)"
    />
    <SaasDetailModal
      :open="showDetails"
      :hostname="selectedHostname"
      :loading="detailLoading"
      :refreshing="refreshing[selectedHostname?.id as string] || false"
      @update:open="handleDetailsOpenChange"
      @edit="openEdit"
      @refresh="refreshHostname"
    />
    <PreferredDomainsModal
      v-model:open="showPreferredManager"
      @update="onPreferredUpdate"
    />
    <SaasFallbackOriginModal
      v-model:open="showFallbackOrigin"
      :provider="provider"
      :zone-name="decodedZoneName"
      @updated="onFallbackUpdated"
    />
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, h } from 'vue'
import { useRouter } from 'vue-router'
import { preferredDomainApi, saasApi } from '../utils/api'
import { dnsApi } from '@/modules/common/dns/api'
import { statusColor, statusLabel, formatDate } from '../utils/saas'
import { providerAvatarColor } from '@/providers/branding'
import { loadProviders } from '@/stores/providers'
import { providerPath } from '@/routes/paths'
import ListToolbar from '@/shared/components/ListToolbar.vue'
import { message, modal } from '@/shared/plugins/antDesignVue'
import BatchToolbar from '@/shared/components/BatchToolbar.vue'
import { errorMessage } from '@/shared/utils/errors'
import { showBatchFailures } from '@/shared/utils/batch'
import { tablePagination } from '@/shared/utils/pagination'
import SaasCreateModal from '../components/SaasCreateModal.vue'
import SaasDetailModal from '../components/SaasDetailModal.vue'
import SaasFallbackOriginModal from '../components/SaasFallbackOriginModal.vue'
import PreferredDomainsModal from '../components/PreferredDomainsModal.vue'
import type { Provider } from '@/types'

const props = defineProps<{
  provider: string
  zoneName: string
}>()

const router = useRouter()

const hostnames = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const notFound = ref(false)
const selectedHostnames = ref<Record<string, unknown>[]>([])
const selectionResetKey = ref(0)
const creating = ref(false)
const editingHostname = ref<Record<string, unknown> | null>(null)
const savingEdit = ref(false)
const deleting = ref(false)
const deletingText = ref('')
const detailLoading = ref(false)
let detailRequestToken = 0
let listLoadRequestToken = 0
let preferredLoadRequestToken = 0
let syncZoneLoadRequestToken = 0
const refreshing = ref<Record<string, boolean>>({})
const providerMeta = ref<Provider | null>(null)
const allProviders = ref<Provider[]>([])
const dnspodZones = ref<Record<string, Array<Record<string, unknown>>>>({})
const cloudflareDnsZones = ref<Record<string, Array<Record<string, unknown>>>>({})
const selectedHostname = ref<Record<string, unknown> | null>(null)
const showCreateForm = ref(false)
const showDetails = ref(false)
const preferredDomains = ref<Array<Record<string, unknown>>>([])
const showPreferredManager = ref(false)
const showFallbackOrigin = ref(false)

const decodedZoneName = computed(() => decodeURIComponent(props.zoneName))
const zonesPath = computed(() => providerPath(props.provider))
const hostnameCloudflareProvider = computed(() => {
  const providerId = providerMeta.value?.cloudflare_provider || ''
  if (!providerId) return null
  return allProviders.value.find((provider) => provider.id === providerId && provider.type === 'cloudflare' && provider.configured) || null
})
const dnspodProviders = computed(() => allProviders.value.filter((provider) => provider.type === 'dnspod' && provider.configured))
const cloudflareProviders = computed(() => hostnameCloudflareProvider.value ? [hostnameCloudflareProvider.value] : [])
const dnspodLinked = computed(() => dnspodProviders.value.length > 0)
const cloudflareDnsLinked = computed(() => cloudflareProviders.value.length > 0)
const originSuggestions = computed(() => {
  const seen = new Set<string>()
  const list = []
  for (const h of hostnames.value) {
    const v = String((h as Record<string, unknown>)?.custom_origin_server || '').trim()
    if (v !== '' && !seen.has(v)) {
      seen.add(v)
      list.push({ value: v })
    }
  }
  return list
})
const columns = computed(() => [
  { title: '自定义主机名', dataIndex: 'hostname', key: 'hostname', width: 240 },
  { title: '证书状态', key: 'ssl_status', width: 100 },
  { title: '到期日期', key: 'expires_on', width: 110 },
  { title: '主机名状态', key: 'status', width: 100 },
  { title: '源服务器', key: 'custom_origin_server', width: 200 },
  { title: '操作', key: 'actions', width: 110, align: 'right' },
])
const pagination = computed(() => tablePagination())

onMounted(async () => {
  await load()
  loadPreferredDomains()
})

watch(() => props.provider, () => {
  resetContextState()
  providerMeta.value = null
  dnspodZones.value = {}
  cloudflareDnsZones.value = {}
  load()
  loadPreferredDomains()
})
watch(() => props.zoneName, () => {
  resetContextState()
  load()
})

function hostnameAvatar(hostname: string) {
  return (String(hostname || '').match(/[a-z0-9]/i)?.[0] || '#').toUpperCase()
}
function hostnameAvatarColor() {
  return providerAvatarColor('saas')
}
function resetContextState() {
  showCreateForm.value = false
  showDetails.value = false
  showFallbackOrigin.value = false
  editingHostname.value = null
  selectedHostname.value = null
  selectedHostnames.value = []
  selectionResetKey.value += 1
  handleDetailsOpenChange(false)
}
function clearSelection() {
  selectedHostnames.value = []
  selectionResetKey.value += 1
}

async function load(options: Record<string, unknown> = {}) {
  const requestToken = listLoadRequestToken + 1
  listLoadRequestToken = requestToken
  loading.value = true
  try {
    notFound.value = false
    if (!providerMeta.value) {
      const providers = await loadProviders()
      if (requestToken !== listLoadRequestToken) return
      allProviders.value = providers || []
      providerMeta.value = providers.find((p) => p.id === props.provider) || null
      await loadSyncZones(requestToken)
    }
    if (requestToken !== listLoadRequestToken) return
    const response = await saasApi.hostnames(props.provider, decodedZoneName.value, {
      page: 1,
      per_page: 100,
      ...options,
    })
    if (requestToken !== listLoadRequestToken) return
    hostnames.value = response.data
    syncSelectedHostnameFromList()
  } catch (error) {
    if (requestToken !== listLoadRequestToken) return
    const e = error as { status?: number; code?: string }
    if (Number(e.status) === 404 || e.code === 'cloudflare_zone_not_found') {
      hostnames.value = []
      notFound.value = true
      return
    }
    message.error(errorMessage(error))
  } finally {
    if (requestToken === listLoadRequestToken) loading.value = false
  }
}

async function loadSyncZones(requestToken = listLoadRequestToken) {
  const zoneRequestToken = syncZoneLoadRequestToken + 1
  syncZoneLoadRequestToken = zoneRequestToken

  try {
    const [dnspod, cloudflareDns] = await Promise.all([
      loadZonesForProviders(dnspodProviders.value),
      loadZonesForProviders(cloudflareProviders.value),
    ])

    if (requestToken !== listLoadRequestToken || zoneRequestToken !== syncZoneLoadRequestToken) return
    dnspodZones.value = dnspod
    cloudflareDnsZones.value = cloudflareDns
  } catch {
    if (requestToken !== listLoadRequestToken || zoneRequestToken !== syncZoneLoadRequestToken) return
    dnspodZones.value = {}
    cloudflareDnsZones.value = {}
  }
}

async function loadZonesForProvider(providerId: string) {
  const zones: Record<string, unknown>[] = []
  let page = 1

  while (true) {
    const response = await dnsApi.zones(providerId, { page, per_page: 100, refresh: page === 1 })
    zones.push(...response.data)
    const totalPages = Number(response.meta?.total_pages || 1)
    if (page >= totalPages) break
    page += 1
  }

  return zones
}

async function loadZonesForProviders(providers: Provider[]) {
  const map: Record<string, Array<Record<string, unknown>>> = {}
  for (const provider of providers || []) {
    map[provider.id] = await loadZonesForProvider(provider.id)
  }
  return map
}

async function loadPreferredDomains() {
  const requestToken = preferredLoadRequestToken + 1
  preferredLoadRequestToken = requestToken
  try {
    const response = await preferredDomainApi.list()
    if (requestToken !== preferredLoadRequestToken) return
    preferredDomains.value = response.data
  } catch (error) {
    if (requestToken !== preferredLoadRequestToken) return
    preferredDomains.value = []
  }
}

function openPreferredManager() { showPreferredManager.value = true }
function onPreferredUpdate(items: Array<Record<string, unknown>>) { preferredDomains.value = items || [] }

function dnsOperationMessage(operation: { message?: string } | undefined, fallback: string) {
  if (!operation) return fallback
  return operation.message || fallback
}

function openFallbackOrigin() { showFallbackOrigin.value = true }
function onFallbackUpdated() {
  load({ refresh: true })
}

async function handleRefresh() {
  await load({ refresh: true })
  message.success('已刷新')
}

function openCreate() { editingHostname.value = null; showCreateForm.value = true }
async function create(formData: Record<string, unknown>) {
  creating.value = true
  try {
    const payload: Record<string, unknown> = {
      hostname: String(formData.hostname || '').trim(),
      method: String(formData.method || 'txt').trim(),
      min_tls_version: String(formData.min_tls_version || '1.0').trim(),
    }
    if (formData.use_custom_origin_server) {
      payload.custom_origin_server = String(formData.custom_origin_server || '').trim()
    }
    const preferred = String(formData.preferred_domain || '').trim()
    if (preferred) {
      payload.preferred_domain = preferred
    }
    if (formData.sync_target) payload.sync_target = String(formData.sync_target).trim()
    if (formData.sync_provider_id) payload.sync_provider_id = String(formData.sync_provider_id).trim()
    if (formData.sync_zone) payload.sync_zone = String(formData.sync_zone).trim()
    payload.auto_preferred = !!formData.autoPreferred
    if (!payload.hostname) {
      message.warning('请输入主机名')
      return
    }

    const options = { autoSync: !!formData.sync_target }
    const response = (await saasApi.createHostname(props.provider, decodedZoneName.value, payload, options)) as { data: Record<string, unknown> }
    const dnsSync = ((response?.data?.side_effects as Record<string, unknown>)?.dns as { sync?: { message?: string } })?.sync
    message.success(dnsOperationMessage(dnsSync, '自定义主机名已创建'))
    showCreateForm.value = false
    await load({ refresh: true })
    await openDetails(response.data)
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    creating.value = false
  }
}

function openEdit(record: Record<string, unknown>) {
  handleDetailsOpenChange(false)
  editingHostname.value = record
  showCreateForm.value = true
}
async function update(formData: Record<string, unknown>) {
  if (!editingHostname.value?.hostname) return

  savingEdit.value = true
  try {
    const payload: Record<string, unknown> = {
      method: String(formData.method || 'txt').trim(),
      min_tls_version: String(formData.min_tls_version || '1.0').trim(),
      custom_origin_server: formData.use_custom_origin_server
        ? String(formData.custom_origin_server || '').trim()
        : '',
      preferred_domain: String(formData.preferred_domain || '').trim(),
      sync_target: String(formData.sync_target || '').trim(),
      sync_provider_id: String(formData.sync_provider_id || '').trim(),
      sync_zone: String(formData.sync_zone || '').trim(),
      auto_preferred: !!formData.autoPreferred,
    }

    const options = { autoSync: !!formData.sync_target }
    const response = (await saasApi.updateHostname(
      props.provider,
      decodedZoneName.value,
      editingHostname.value.hostname as string,
      payload,
      options,
    )) as { data: Record<string, unknown> }
    const dnsSync = ((response?.data?.side_effects as Record<string, unknown>)?.dns as { sync?: { message?: string } })?.sync
    message.success(dnsOperationMessage(dnsSync, '自定义主机名已更新'))
    showCreateForm.value = false
    editingHostname.value = null
    mergeHostnameRecord(response.data)
    await load({ refresh: true })
    if (showDetails.value && selectedHostname.value?.id === response.data?.id) {
      await openDetails(response.data)
    }
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    savingEdit.value = false
  }
}

async function openDetails(record: Record<string, unknown>) {
  selectedHostname.value = {
    ...record,
    ssl: { ...(record?.ssl as Record<string, unknown> || {}) },
  }
  showDetails.value = true
  detailLoading.value = false
}
async function refreshHostname(record: Record<string, unknown>) {
  refreshing.value = { ...refreshing.value, [record.id as string]: true }
  try {
    const response = (await saasApi.refreshHostname(props.provider, decodedZoneName.value, record.hostname as string)) as { data: Record<string, unknown> }
    mergeHostnameRecord(response.data)
    if (showDetails.value && selectedHostname.value?.id === record.id) {
      selectedHostname.value = response.data
    }
    const cleanup = (((response.data as Record<string, unknown>)?.side_effects as Record<string, unknown>)?.dns as Record<string, unknown>)?.cleanup as { details?: { cleaned?: number } }
    const cleaned = Number(cleanup?.details?.cleaned || 0)
    message.success(cleaned > 0 ? '已刷新,已自动清理TXT验证' : '已刷新')
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    refreshing.value = { ...refreshing.value, [record.id as string]: false }
  }
}
function askDelete(record: Record<string, unknown>) {
  modal.confirm({
    title: '删除自定义主机名',
    content: `确认删除 ${record.hostname}？关联的 DNSPod 记录会一并清理。`,
    okText: '删除', okType: 'danger', cancelText: '取消',
    onOk: () => deleteHostname(record),
  })
}
function askBatchDelete() {
  if (!selectedHostnames.value.length) return
  const total = selectedHostnames.value.length
  let dialog: ReturnType<typeof modal.confirm> | null = null
  dialog = modal.confirm({
    title: '批量删除自定义主机名',
    content: batchDeleteConfirmContent(total),
    okText: '批量删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => batchDeleteHostnames(dialog, total),
  })
}
function batchDeleteConfirmContent(total: number) {
  const base = `确认删除已选的 ${total} 个自定义主机名？关联的 DNS 记录会按可用情况清理。`
  return h('div', { style: 'white-space: pre-wrap' }, deletingText.value ? `${base}\n\n${deletingText.value}` : base)
}
function updateBatchDeleteDialog(dialog: ReturnType<typeof modal.confirm> | null, total: number) {
  dialog?.update?.({
    content: batchDeleteConfirmContent(total),
    cancelButtonProps: { disabled: deleting.value },
  })
}
function isCurrentHostname(record: Record<string, unknown>) {
  if (!record || !selectedHostname.value) return false
  const currentId = selectedHostname.value.id
  const recordId = record.id
  if (currentId && recordId) return currentId === recordId

  const currentHostname = String(selectedHostname.value.hostname || '').trim().toLowerCase()
  const recordHostname = String(record.hostname || '').trim().toLowerCase()
  return currentHostname !== '' && currentHostname === recordHostname
}
async function deleteHostname(record: Record<string, unknown>) {
  deleting.value = true
  try {
    const response = (await saasApi.deleteHostname(props.provider, decodedZoneName.value, record.hostname as string)) as { data: Record<string, unknown> }
    const dnsCleanup = ((response?.data?.side_effects as Record<string, unknown>)?.dns as Record<string, unknown>)?.cleanup as { message?: string }
    message.success(dnsOperationMessage(dnsCleanup, '已删除'))
    if (isCurrentHostname(record)) {
      selectedHostname.value = null
      showDetails.value = false
    }
    clearSelection()
    await load({ refresh: true })
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    deleting.value = false
  }
}
async function batchDeleteHostnames(dialog: ReturnType<typeof modal.confirm> | null, total: number) {
  deleting.value = true
  const failed: string[] = []
  const deletingCurrent = selectedHostnames.value.some((record) => isCurrentHostname(record))
  try {
    deletingText.value = '正在删除 0/' + total
    updateBatchDeleteDialog(dialog, total)
    const records = [...selectedHostnames.value]
    for (const [index, record] of records.entries()) {
      deletingText.value = `正在删除 ${index + 1}/${records.length}`
      updateBatchDeleteDialog(dialog, total)
      try {
        await saasApi.deleteHostname(props.provider, decodedZoneName.value, record.hostname as string)
      } catch (error) {
        failed.push(`${record.hostname}: ${errorMessage(error)}`)
      }
    }
    if (failed.length) showBatchFailures('批量删除完成', failed, '个')
    else message.success('批量删除完成')
    if (deletingCurrent) {
      selectedHostname.value = null
      showDetails.value = false
    }
    clearSelection()
    await load({ refresh: true })
  } finally {
    deleting.value = false
    deletingText.value = ''
  }
}

function mergeHostnameRecord(updated: Record<string, unknown>) {
  if (!updated?.id) return
  const index = hostnames.value.findIndex((item) => item.id === updated.id)
  if (index >= 0) hostnames.value.splice(index, 1, { ...hostnames.value[index], ...updated })
}

function syncSelectedHostnameFromList() {
  if (!selectedHostname.value) return
  const selectedId = selectedHostname.value.id
  const selectedName = String(selectedHostname.value.hostname || '').toLowerCase()
  const updated = hostnames.value.find((item) => (
    (selectedId && item.id === selectedId)
    || String(item.hostname || '').toLowerCase() === selectedName
  ))
  if (!updated) return

  selectedHostname.value = {
    ...selectedHostname.value,
    ...updated,
    ssl: { ...(selectedHostname.value.ssl as Record<string, unknown> || {}), ...(updated.ssl as Record<string, unknown> || {}) },
  }
}

function handleDetailsOpenChange(open: boolean) {
  showDetails.value = open
  if (!open) {
    detailRequestToken += 1
    detailLoading.value = false
  }
}
</script>
