import { ref, computed, watch, onMounted, h } from 'vue'
import { useRouter } from 'vue-router'
import { edgeOneApi } from '../utils/api'
import { providerPath } from '@/routes/paths'
import { loadProviders } from '@/stores/providers'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { useLatestTask } from '@/shared/composables/useLatestTask'
import { errorMessage } from '@/shared/utils/errors'
import { tablePagination } from '@/shared/utils/pagination'
import { showBatchFailures } from '@/shared/utils/batch'
import { useJobProgress } from '@/shared/composables/useJobProgress'
import type { EdgeOneAccelerationDomain, EdgeOneZone, Provider } from '@/types'

export function useEdgeOneRecords(props: { provider: string; zoneId: string }) {
  const router = useRouter()

  const records = ref<EdgeOneAccelerationDomain[]>([])
  const recordMeta = ref({ page: 1, per_page: 20, total: 0 })
  const selectedRecords = ref<EdgeOneAccelerationDomain[]>([])
  const selectionResetKey = ref(0)
  const notFound = ref(false)
  const editing = ref<EdgeOneAccelerationDomain | null>(null)
  const certEditing = ref<EdgeOneAccelerationDomain | null>(null)
  const showForm = ref(false)
  const showCertForm = ref(false)
  const loading = ref(true)
  const saving = ref(false)
  const deleting = ref(false)
  const statusUpdating = ref(false)
  const deletingText = ref('')
  const statusUpdatingText = ref('')
  const jobProgress = useJobProgress()
  const providerMeta = ref<Provider | null>(null)
  const zoneMeta = ref<EdgeOneZone | null>(null)
  const loadTask = useLatestTask()

  const decodedZoneId = computed(() => decodeURIComponent(props.zoneId))
  const displayZoneName = computed(() => zoneMeta.value?.name || '')
  const zonesPath = computed(() => providerPath(props.provider))
  const dnspodLinked = computed(() => Boolean(providerMeta.value?.dnspod_provider))
  const pagination = computed(() =>
    tablePagination({
      current: recordMeta.value.page || 1,
      pageSize: recordMeta.value.per_page || 20,
      total: recordMeta.value.total || 0,
    })
  )
  const batchDeleteDisabled = computed(() => selectedRecords.value.some((record) => record.status !== 'offline'))

  onMounted(async () => {
    await load()
  })

  watch(
    () => props.provider,
    () => {
      providerMeta.value = null
      resetAndLoad()
    }
  )
  watch(
    () => props.zoneId,
    () => {
      resetAndLoad()
    }
  )

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
    if (!loadTask.isCurrent(requestToken)) return
    zoneMeta.value = response.data || null
  }

  function handleTableChange(pagination: { current?: number; pageSize?: number }) {
    const nextPerPage = Number(pagination?.pageSize) || recordMeta.value.per_page || 20
    const pageSizeChanged = nextPerPage !== recordMeta.value.per_page
    const nextPage = pageSizeChanged ? 1 : Number(pagination?.current) || 1
    if (nextPage === recordMeta.value.page && nextPerPage === recordMeta.value.per_page) return
    recordMeta.value = { ...recordMeta.value, page: nextPage, per_page: nextPerPage }
    load()
  }

  async function load(options: Record<string, unknown> = {}) {
    const requestToken = loadTask.next()
    loading.value = true
    try {
      notFound.value = false
      if (!providerMeta.value) {
        const providers = await loadProviders()
        if (!loadTask.isCurrent(requestToken)) return
        providerMeta.value = providers.find((p) => p.id === props.provider) || null
      }
      if (!loadTask.isCurrent(requestToken)) return
      await ensureZoneMeta(requestToken)
      if (!loadTask.isCurrent(requestToken)) return
      const response = await edgeOneApi.accelerationDomains(props.provider, decodedZoneId.value, {
        page: recordMeta.value.page,
        per_page: recordMeta.value.per_page,
        ...options,
      })
      if (!loadTask.isCurrent(requestToken)) return
      records.value = response.data
      recordMeta.value = {
        page: Number(response.meta?.page) || recordMeta.value.page,
        per_page: Number(response.meta?.per_page) || recordMeta.value.per_page,
        total: Number(response.meta?.total) || 0,
      }
      if (options.refresh) message.success('已刷新')
    } catch (error) {
      if (!loadTask.isCurrent(requestToken)) return
      const e = error as { status?: number; code?: string }
      if (Number(e.status) === 404 || e.code === 'edgeone_zone_not_found') {
        records.value = []
        notFound.value = true
        return
      }

      message.error(errorMessage(error))
    } finally {
      if (loadTask.isCurrent(requestToken)) loading.value = false
    }
  }

  function edit(record: EdgeOneAccelerationDomain) {
    editing.value = { ...record }
    showForm.value = true
  }

  function create() {
    editing.value = null
    showForm.value = true
  }

  function clearSelection() {
    selectedRecords.value = []
    selectionResetKey.value += 1
  }

  function configureCertificate(record: EdgeOneAccelerationDomain) {
    certEditing.value = { ...record }
    showCertForm.value = true
  }

  async function save(form: Record<string, unknown>) {
    saving.value = true
    try {
      if (editing.value) {
        await edgeOneApi.updateAccelerationDomain(props.provider, decodedZoneId.value, editing.value.name || '', form)
        message.success('加速域名已更新')
      } else {
        const { autoSync, ...payload } = form
        const result = await edgeOneApi.createAccelerationDomain(props.provider, decodedZoneId.value, payload, {
          autoSync,
        })
        const sync = result.side_effects?.dns?.sync
        if (autoSync && sync?.status === 'failed') {
          message.warning(`加速域名已添加，CNAME 同步失败：${sync.message || '-'}`)
        } else if (autoSync && sync?.status === 'skipped') {
          message.warning(`加速域名已添加，CNAME 稍后需处理：${sync.message || '-'}`)
        } else if (autoSync && sync) {
          message.success(sync.message || 'CNAME 已同步')
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
      await edgeOneApi.updateCertificate(props.provider, decodedZoneId.value, certEditing.value.name || '', form)
      message.success('HTTPS 配置已更新')
      showCertForm.value = false
      await load({ refresh: true })
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      saving.value = false
    }
  }

  function askStatus(record: EdgeOneAccelerationDomain) {
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

  function askRemove(record: EdgeOneAccelerationDomain) {
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
    return h(
      'div',
      { style: 'white-space: pre-wrap' },
      statusUpdatingText.value ? `${base}\n\n${statusUpdatingText.value}` : base
    )
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

  async function remove(record: EdgeOneAccelerationDomain) {
    deleting.value = true
    try {
      const response = await edgeOneApi.deleteAccelerationDomain(
        props.provider,
        decodedZoneId.value,
        record.name || ''
      )
      const cleanup = response.side_effects?.dns?.cleanup?.details
      const cleaned = Number(cleanup?.cleaned || 0)
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

  async function updateStatus(record: EdgeOneAccelerationDomain, status: string) {
    statusUpdating.value = true
    try {
      await edgeOneApi.updateAccelerationDomainStatus(props.provider, decodedZoneId.value, record.name || '', status)
      message.success(status === 'offline' ? '已停用' : '已启用')
      await load({ refresh: true })
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      statusUpdating.value = false
    }
  }

  async function batchDisable(dialog: ReturnType<typeof modal.confirm> | null, records: EdgeOneAccelerationDomain[]) {
    statusUpdating.value = true
    const total = records.length
    try {
      statusUpdatingText.value = `正在创建批量停用任务 0/${total}`
      updateBatchStatusDialog(dialog, total)
      const domains = records.map((item) => item.name || '').filter(Boolean)
      const created = await edgeOneApi.batchDisable(props.provider, decodedZoneId.value, { domains })
      const jobId = String((created.data as any)?.id || '')
      if (!jobId) throw new Error('创建批量停用任务失败')

      const job = await jobProgress.pollJob(jobId, {
        fetchJob: async (id) => ((await edgeOneApi.batchJob(props.provider, id)).data as any) || {},
        onTick: (current) => {
          statusUpdatingText.value = current.current
            ? `后台停用 ${current.done || 0}/${current.total || total}：${current.current}`
            : `后台停用 ${current.done || 0}/${current.total || total}`
          updateBatchStatusDialog(dialog, total)
        },
      })

      const failedItems = jobProgress.failedItems(job)
      if (failedItems.length) {
        showBatchFailures(
          job?.message || '批量停用完成',
          failedItems.map((i: any) => `${i.domain}: ${i.message || '失败'}`),
          '个',
        )
      } else {
        message.success(job?.message || '批量停用完成')
      }

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
    try {
      deletingText.value = `正在创建批量删除任务 0/${total}`
      updateBatchRemoveDialog(dialog, base)
      const domains = selectedRecords.value.map((item) => item.name || '').filter(Boolean)
      const created = await edgeOneApi.batchDelete(props.provider, decodedZoneId.value, { domains })
      const jobId = String((created.data as any)?.id || '')
      if (!jobId) throw new Error('创建批量删除任务失败')

      const job = await jobProgress.pollJob(jobId, {
        fetchJob: async (id) => ((await edgeOneApi.batchJob(props.provider, id)).data as any) || {},
        onTick: (current) => {
          deletingText.value = current.current
            ? `后台删除 ${current.done || 0}/${current.total || total}：${current.current}`
            : `后台删除 ${current.done || 0}/${current.total || total}`
          updateBatchRemoveDialog(dialog, base)
        },
      })

      const failedItems = jobProgress.failedItems(job)
      if (failedItems.length) {
        showBatchFailures(
          job?.message || '批量删除完成',
          failedItems.map((i: any) => `${i.domain}: ${i.message || '失败'}`),
          '个',
        )
      } else {
        message.success(job?.message || '批量删除完成')
      }
      clearSelection()
      await load({ refresh: true })
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      deleting.value = false
      deletingText.value = ''
    }
  }

  return {
    router,
    records,
    recordMeta,
    selectedRecords,
    selectionResetKey,
    notFound,
    editing,
    certEditing,
    showForm,
    showCertForm,
    loading,
    saving,
    deleting,
    statusUpdating,
    deletingText,
    statusUpdatingText,
    providerMeta,
    zoneMeta,
    decodedZoneId,
    displayZoneName,
    zonesPath,
    dnspodLinked,
    pagination,
    batchDeleteDisabled,
    load,
    handleTableChange,
    edit,
    create,
    clearSelection,
    configureCertificate,
    save,
    saveCertificate,
    askStatus,
    askRemove,
    askBatchRemove,
    askBatchDisable,
  }
}
