<template>
  <section>
    <div class="page-toolbar">
      <div>
        <a-button type="link" style="padding: 0" @click="router.push(zonesPath)">返回站点</a-button>
        <a-typography-title :level="3" style="margin: 4px 0">{{ displayZoneName || decodedZoneId }}</a-typography-title>
        <a-typography-text type="secondary">EdgeOne 加速域名</a-typography-text>
      </div>
      <div class="page-actions">
        <a-button :loading="loading" :disabled="saving || deleting || statusUpdating" @click="load({ refresh: true })">刷新</a-button>
        <a-button v-if="!notFound" type="primary" :disabled="saving || deleting || statusUpdating || !displayZoneName" @click="create">添加加速域名</a-button>
      </div>
    </div>
    <a-result v-if="notFound" status="404" title="站点不存在或未配置" :sub-title="decodedZoneId">
      <template #extra><a-button type="primary" @click="router.push(zonesPath)">返回 EdgeOne</a-button></template>
    </a-result>
    <template v-else>
    <BatchToolbar :count="selectedRecords.length" :deleting="deleting || statusUpdating" delete-text="批量删除" :delete-disabled="batchDeleteDisabled" :actions="[{ key: 'offline', label: '批量停用', loading: statusUpdating, disabled: selectedRecords.every(record => record.status === 'offline') }]" @delete="askBatchRemove" @action="key => { if (key === 'offline') askBatchDisable() }" @clear="clearSelection" />
    <EdgeOneRecordTable
      :records="records"
      :loading="loading"
      :pagination="pagination"
      :selection-reset-key="selectionResetKey"
      :actions-disabled="saving || deleting || statusUpdating"
      empty-text="暂无匹配的加速域名"
      @edit="edit"
      @status="askStatus"
      @certificate="configureCertificate"
      @delete="askRemove"
      @change="handleTableChange"
      @selection-change="selectedRecords = $event"
    />
    <a-modal v-model:open="showForm" :title="editing ? '编辑加速域名' : '添加加速域名'" :footer="null" destroy-on-close>
      <EdgeOneRecordForm :model-value="editing" :saving="saving" :zone-name="displayZoneName" :dnspod-linked="dnspodLinked" @save="save" @cancel="showForm = false" />
    </a-modal>
    <a-modal v-model:open="showCertForm" title="HTTPS 配置" :footer="null" destroy-on-close>
      <EdgeOneCertificateForm :model-value="certEditing" :saving="saving" @save="saveCertificate" @cancel="showCertForm = false" />
    </a-modal>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, h } from 'vue'
import { useRouter } from 'vue-router'
import { edgeOneApi } from '../utils/api'
import { providerPath } from '@/routes/paths'
import { loadProviders } from '@/stores/providers'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'
import { tablePagination } from '@/shared/utils/pagination'
import { showBatchFailures } from '@/shared/utils/batch'
import BatchToolbar from '@/shared/components/BatchToolbar.vue'
import EdgeOneCertificateForm from '../components/EdgeOneCertificateForm.vue'
import EdgeOneRecordForm from '../components/EdgeOneRecordForm.vue'
import EdgeOneRecordTable from '../components/EdgeOneRecordTable.vue'
import type { Provider } from '@/types'

const props = defineProps<{
  provider: string
  zoneId: string
}>()

const router = useRouter()

const records = ref<Record<string, unknown>[]>([])
const recordMeta = ref({ page: 1, per_page: 20, total: 0 })
const selectedRecords = ref<Record<string, unknown>[]>([])
const selectionResetKey = ref(0)
const notFound = ref(false)
const editing = ref<Record<string, unknown> | null>(null)
const certEditing = ref<Record<string, unknown> | null>(null)
const showForm = ref(false)
const showCertForm = ref(false)
const loading = ref(true)
const saving = ref(false)
const deleting = ref(false)
const statusUpdating = ref(false)
const deletingText = ref('')
const statusUpdatingText = ref('')
const providerMeta = ref<Provider | null>(null)
const zoneMeta = ref<Record<string, unknown> | null>(null)
let loadRequestToken = 0

const decodedZoneId = computed(() => decodeURIComponent(props.zoneId))
const displayZoneName = computed(() => (zoneMeta.value?.name as string) || '')
const zonesPath = computed(() => providerPath(props.provider))
const dnspodLinked = computed(() => Boolean(providerMeta.value?.dnspod_provider))
const pagination = computed(() => tablePagination({
  current: recordMeta.value.page || 1,
  pageSize: recordMeta.value.per_page || 20,
  total: recordMeta.value.total || 0,
}))
const batchDeleteDisabled = computed(() => selectedRecords.value.some((record) => record.status !== 'offline'))

onMounted(async () => {
  await load()
})

watch(() => props.provider, () => { providerMeta.value = null; resetAndLoad() })
watch(() => props.zoneId, () => { resetAndLoad() })

function resetAndLoad() {
  clearSelection()
  editing.value = null
  certEditing.value = null
  showForm.value = false
  showCertForm.value = false
  notFound.value = false
  zoneMeta.value = null
  recordMeta.value = { page: 1, per_page: 20, total: 0 }
  load()
}
async function ensureZoneMeta(requestToken: number) {
  if (zoneMeta.value) return
  const response = await edgeOneApi.zone(props.provider, decodedZoneId.value)
  if (requestToken !== loadRequestToken) return
  zoneMeta.value = (response.data as Record<string, unknown>) || null
}
function handleTableChange(pagination: { current?: number; pageSize?: number }) {
  const nextPerPage = Number(pagination?.pageSize) || recordMeta.value.per_page || 20
  const pageSizeChanged = nextPerPage !== recordMeta.value.per_page
  const nextPage = pageSizeChanged ? 1 : (Number(pagination?.current) || 1)
  if (nextPage === recordMeta.value.page && nextPerPage === recordMeta.value.per_page) return
  recordMeta.value = { ...recordMeta.value, page: nextPage, per_page: nextPerPage }
  load()
}
async function load(options: Record<string, unknown> = {}) {
  const requestToken = loadRequestToken + 1
  loadRequestToken = requestToken
  loading.value = true
  try {
    notFound.value = false
    if (!providerMeta.value) {
      const providers = await loadProviders()
      if (requestToken !== loadRequestToken) return
      providerMeta.value = providers.find((p) => p.id === props.provider) || null
    }
    if (requestToken !== loadRequestToken) return
    await ensureZoneMeta(requestToken)
    if (requestToken !== loadRequestToken) return
    const response = await edgeOneApi.accelerationDomains(props.provider, decodedZoneId.value, {
      page: recordMeta.value.page,
      per_page: recordMeta.value.per_page,
      ...options,
    })
    if (requestToken !== loadRequestToken) return
    records.value = response.data
    recordMeta.value = {
      page: (response.meta as Record<string, number>)?.page || recordMeta.value.page,
      per_page: (response.meta as Record<string, number>)?.per_page || recordMeta.value.per_page,
      total: (response.meta as Record<string, number>)?.total || 0,
    }
    if (options.refresh) message.success('已刷新')
  } catch (error) {
    if (requestToken !== loadRequestToken) return
    const e = error as { status?: number; code?: string }
    if (Number(e.status) === 404 || e.code === 'edgeone_zone_not_found') {
      records.value = []
      notFound.value = true
      return
    }

    message.error(errorMessage(error))
  } finally {
    if (requestToken === loadRequestToken) loading.value = false
  }
}
function edit(record: Record<string, unknown>) { editing.value = { ...record }; showForm.value = true }
function create() { editing.value = null; showForm.value = true }
function clearSelection() { selectedRecords.value = []; selectionResetKey.value += 1 }
function configureCertificate(record: Record<string, unknown>) { certEditing.value = { ...record }; showCertForm.value = true }
async function save(form: Record<string, unknown>) {
  saving.value = true
  try {
    if (editing.value) {
      await edgeOneApi.updateAccelerationDomain(props.provider, decodedZoneId.value, editing.value.name as string, form)
      message.success('加速域名已更新')
    } else {
      const { autoSync, ...payload } = form
      const result = await edgeOneApi.createAccelerationDomain(props.provider, decodedZoneId.value, payload, { autoSync })
      const sync = (result?.data as Record<string, unknown>)?.side_effects as { dns?: { sync?: { status?: string; message?: string } } }
      if (autoSync && sync?.dns?.sync && sync.dns.sync.status === 'failed') {
        message.warning(`加速域名已添加，CNAME 同步失败：${sync.dns.sync.message || '-'}`)
      } else if (autoSync && sync?.dns?.sync && sync.dns.sync.status === 'skipped') {
        message.warning(`加速域名已添加，CNAME 稍后需处理：${sync.dns.sync.message || '-'}`)
      } else if (autoSync && sync?.dns?.sync) {
        message.success(sync.dns.sync.message || 'CNAME 已同步')
      } else {
        message.success('加速域名已添加')
      }
    }
    showForm.value = false
    await load({ refresh: true })
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}
async function saveCertificate(form: Record<string, unknown>) {
  if (!certEditing.value) return
  saving.value = true
  try {
    await edgeOneApi.updateCertificate(props.provider, decodedZoneId.value, certEditing.value.name as string, form)
    message.success('HTTPS 配置已更新')
    showCertForm.value = false
    await load({ refresh: true })
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}
function askStatus(record: Record<string, unknown>) {
  const nextStatus = record.status === 'offline' ? 'online' : 'offline'
  const action = nextStatus === 'online' ? '启用' : '停用'
  modal.confirm({
    title: `${action}加速域名`,
    content: `确认${action} ${record.name}？`,
    okText: action,
    okType: nextStatus === 'offline' ? 'danger' : 'primary',
    cancelText: '取消',
    onOk: () => updateStatus(record, nextStatus),
  })
}
function askRemove(record: Record<string, unknown>) {
  if (record.status !== 'offline') {
    message.error('请先停用加速域名，再删除')
    return
  }
  const content = dnspodLinked.value
    ? `确认删除 ${record.name}？关联的 DNSPod CNAME 记录会一并清理。`
    : `确认删除 ${record.name}？删除后将从 EdgeOne 移除。`
  modal.confirm({
    title: '删除加速域名',
    content,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => remove(record),
  })
}
function askBatchRemove() {
  if (!selectedRecords.value.length) return
  if (selectedRecords.value.some((record) => record.status !== 'offline')) {
    message.error('只能删除已停用的加速域名')
    return
  }
  const total = selectedRecords.value.length
  const content = dnspodLinked.value
    ? `确认删除已选的 ${total} 个加速域名？关联的 DNSPod CNAME 记录会按可用情况清理。`
    : `确认删除已选的 ${total} 个加速域名？删除后将从 EdgeOne 移除。`
  let dialog: ReturnType<typeof modal.confirm> | null = null
  dialog = modal.confirm({
    title: '批量删除加速域名',
    content: batchRemoveConfirmContent(content),
    okText: '批量删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => batchRemove(dialog, total, content),
  })
}
function askBatchDisable() {
  const onlineRecords = selectedRecords.value.filter((record) => record.status !== 'offline')
  if (!onlineRecords.length) {
    message.warning('已选域名均已停用')
    return
  }

  const total = onlineRecords.length
  let dialog: ReturnType<typeof modal.confirm> | null = null
  dialog = modal.confirm({
    title: '批量停用加速域名',
    content: batchStatusConfirmContent(total),
    okText: '批量停用',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => batchDisable(dialog, onlineRecords),
  })
}
function batchStatusConfirmContent(total: number) {
  const base = `确认停用已选的 ${total} 个加速域名？`
  return h('div', { style: 'white-space: pre-wrap' }, statusUpdatingText.value ? `${base}\n\n${statusUpdatingText.value}` : base)
}
function updateBatchStatusDialog(dialog: ReturnType<typeof modal.confirm> | null, total: number) {
  dialog?.update?.({
    content: batchStatusConfirmContent(total),
    cancelButtonProps: { disabled: statusUpdating.value },
  })
}
function batchRemoveConfirmContent(base: string) {
  return h('div', { style: 'white-space: pre-wrap' }, deletingText.value ? `${base}\n\n${deletingText.value}` : base)
}
function updateBatchRemoveDialog(dialog: ReturnType<typeof modal.confirm> | null, base: string) {
  dialog?.update?.({
    content: batchRemoveConfirmContent(base),
    cancelButtonProps: { disabled: deleting.value },
  })
}
async function remove(record: Record<string, unknown>) {
  deleting.value = true
  try {
    const response = await edgeOneApi.deleteAccelerationDomain(props.provider, decodedZoneId.value, record.name as string)
    const sideEffects = (response?.data as Record<string, unknown>)?.side_effects as Record<string, unknown> | undefined
    const dnsEffects = sideEffects?.dns as Record<string, unknown> | undefined
    const cleanup = dnsEffects?.cleanup as Record<string, unknown> | undefined
    const details = cleanup?.details as Record<string, unknown> | undefined
    const cleaned = Number(details?.cleaned || 0)
    message.success(cleaned > 0 ? '已删除，DNSPod CNAME 已清理' : '已删除')
    clearSelection()
    await load({ refresh: true })
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    deleting.value = false
    deletingText.value = ''
  }
}
async function updateStatus(record: Record<string, unknown>, status: string) {
  statusUpdating.value = true
  try {
    await edgeOneApi.updateAccelerationDomainStatus(props.provider, decodedZoneId.value, record.name as string, status)
    message.success(status === 'offline' ? '已停用' : '已启用')
    await load({ refresh: true })
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    statusUpdating.value = false
  }
}
async function batchDisable(dialog: ReturnType<typeof modal.confirm> | null, records: Record<string, unknown>[]) {
  statusUpdating.value = true
  const failed: string[] = []
  const total = records.length
  try {
    statusUpdatingText.value = '正在停用 0/' + total
    updateBatchStatusDialog(dialog, total)
    for (const [index, record] of records.entries()) {
      statusUpdatingText.value = `正在停用 ${index + 1}/${total}`
      updateBatchStatusDialog(dialog, total)
      try {
        await edgeOneApi.updateAccelerationDomainStatus(props.provider, decodedZoneId.value, record.name as string, 'offline')
      } catch (error) {
        failed.push(`${record.name}: ${errorMessage(error)}`)
      }
    }

    if (failed.length) showBatchFailures('批量停用完成', failed, '个')
    else message.success('批量停用完成')

    clearSelection()
    await load({ refresh: true })
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    statusUpdating.value = false
    statusUpdatingText.value = ''
  }
}
async function batchRemove(dialog: ReturnType<typeof modal.confirm> | null, total: number, base: string) {
  deleting.value = true
  const failed: string[] = []
  try {
    deletingText.value = '正在删除 0/' + total
    updateBatchRemoveDialog(dialog, base)
    const records = [...selectedRecords.value]
    for (const [index, record] of records.entries()) {
      deletingText.value = `正在删除 ${index + 1}/${records.length}`
      updateBatchRemoveDialog(dialog, base)
      try {
        await edgeOneApi.deleteAccelerationDomain(props.provider, decodedZoneId.value, record.name as string)
      } catch (error) {
        failed.push(`${record.name}: ${errorMessage(error)}`)
      }
    }
    if (failed.length) showBatchFailures('批量删除完成', failed, '个')
    else message.success('批量删除完成')
    clearSelection()
    await load({ refresh: true })
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    deleting.value = false
    deletingText.value = ''
  }
}
</script>
