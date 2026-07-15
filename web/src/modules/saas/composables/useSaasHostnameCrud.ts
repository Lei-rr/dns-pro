import { ref, h } from 'vue'
import { saasApi } from '../utils/api'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'
import { showBatchFailures } from '@/shared/utils/batch'
import type { SaaSHostname } from '@/types'

export function useSaasHostnameCrud({
  props,
  hostnames,
  selectedHostnames,
  selectedHostname,
  showDetails,
  editingHostname,
  showCreateForm,
  decodedZoneName,
  load,
  clearSelection,
  openDetails,
}: {
  props: { provider: string; zoneName: string }
  hostnames: { value: SaaSHostname[] }
  selectedHostnames: { value: SaaSHostname[] }
  selectedHostname: { value: SaaSHostname | null }
  showDetails: { value: boolean }
  editingHostname: { value: SaaSHostname | null }
  showCreateForm: { value: boolean }
  decodedZoneName: { value: string }
  load: (options?: Record<string, unknown>) => Promise<void>
  clearSelection: () => void
  openDetails: (record: SaaSHostname) => Promise<void>
}) {
  const creating = ref(false)
  const savingEdit = ref(false)
  const deleting = ref(false)
  const deletingText = ref('')
  const refreshing = ref<Record<string, boolean>>({})
  const applyingPreferred = ref(false)
  const applyingPreferredText = ref('')

  function dnsOperationMessage(operation: { message?: string } | undefined, fallback: string) {
    if (!operation) return fallback
    return operation.message || fallback
  }

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
      const response = await saasApi.createHostname(props.provider, decodedZoneName.value, payload, options)
      const dnsSync = response.side_effects?.dns?.sync
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

  async function update(formData: Record<string, unknown>) {
    if (!editingHostname.value?.hostname) return

    savingEdit.value = true
    try {
      const preferred = String(formData.preferred_domain || '').trim()

      // Edit UI currently only changes certificate/origin/preferred fields.
      // Do NOT send sync_* at all — backend keeps/repairs existing DNS linkage.
      const payload: Record<string, unknown> = {
        method: String(formData.method || 'txt').trim(),
        min_tls_version: String(formData.min_tls_version || '1.0').trim(),
        custom_origin_server: formData.use_custom_origin_server
          ? String(formData.custom_origin_server || '').trim()
          : '',
        preferred_domain: preferred,
        auto_preferred: !!formData.autoPreferred,
      }

      const response = await saasApi.updateHostname(
        props.provider,
        decodedZoneName.value,
        editingHostname.value.hostname,
        payload,
        { autoSync: true },
      )
      const dnsSync = response.side_effects?.dns?.sync
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

  async function refreshHostname(record: SaaSHostname) {
    refreshing.value = { ...refreshing.value, [record.id || '']: true }
    try {
      const response = await saasApi.refreshHostname(props.provider, decodedZoneName.value, record.hostname)
      mergeHostnameRecord(response.data)
      if (showDetails.value && selectedHostname.value?.id === record.id) {
        selectedHostname.value = response.data
      }
      const cleanup = response.side_effects?.dns?.cleanup?.details
      const cleaned = Number(cleanup?.cleaned || 0)
      message.success(cleaned > 0 ? '已刷新,已自动清理TXT验证' : '已刷新')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      refreshing.value = { ...refreshing.value, [record.id || '']: false }
    }
  }

  function isCurrentHostname(record: SaaSHostname) {
    if (!record || !selectedHostname.value) return false
    const currentId = selectedHostname.value.id
    const recordId = record.id
    if (currentId && recordId) return currentId === recordId

    const currentHostname = String(selectedHostname.value.hostname || '')
      .trim()
      .toLowerCase()
    const recordHostname = String(record.hostname || '')
      .trim()
      .toLowerCase()
    return currentHostname !== '' && currentHostname === recordHostname
  }

  function askDelete(record: SaaSHostname) {
    modal.confirm({
      title: '删除自定义主机名',
      content: `确认删除 ${record.hostname}？关联的 DNSPod 记录会一并清理。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => deleteHostname(record),
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

  async function deleteHostname(record: SaaSHostname) {
    deleting.value = true
    try {
      const response = await saasApi.deleteHostname(props.provider, decodedZoneName.value, record.hostname)
      const dnsCleanup = response.side_effects?.dns?.cleanup
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
          await saasApi.deleteHostname(props.provider, decodedZoneName.value, record.hostname)
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

  function mergeHostnameRecord(updated: SaaSHostname) {
    if (!updated?.id) return
    const index = hostnames.value.findIndex((item) => item.id === updated.id)
    if (index >= 0) hostnames.value.splice(index, 1, { ...hostnames.value[index], ...updated })
  }

  async function applyPreferredDomainToList(domain: string) {
    const preferred = String(domain || '').trim()
    if (!preferred) {
      message.warning('请选择优选域名')
      return
    }
    const records = [...hostnames.value]
    if (!records.length) {
      message.warning('当前列表没有可切换的主机名')
      return
    }

    applyingPreferred.value = true
    applyingPreferredText.value = `正在切换 0/${records.length}`
    const failed: string[] = []
    try {
      for (const [index, record] of records.entries()) {
        applyingPreferredText.value = `正在切换 ${index + 1}/${records.length}：${record.hostname}`
        try {
          const response = await saasApi.updateHostname(
            props.provider,
            decodedZoneName.value,
            record.hostname,
            {
              preferred_domain: preferred,
              auto_preferred: true,
            },
            { autoSync: true },
          )
          mergeHostnameRecord(response.data)
          if (selectedHostname.value?.id === response.data?.id) {
            selectedHostname.value = { ...selectedHostname.value, ...response.data }
          }
        } catch (error) {
          failed.push(`${record.hostname}: ${errorMessage(error)}`)
        }
      }

      if (failed.length) showBatchFailures('一键切换优选域名完成', failed, '个')
      else message.success(`已将当前列表 ${records.length} 个主机名切换为 ${preferred}`)
      await load({ refresh: true })
    } finally {
      applyingPreferred.value = false
      applyingPreferredText.value = ''
    }
  }

  return {
    creating,
    savingEdit,
    deleting,
    deletingText,
    refreshing,
    applyingPreferred,
    applyingPreferredText,
    create,
    update,
    refreshHostname,
    askDelete,
    askBatchDelete,
    applyPreferredDomainToList,
    mergeHostnameRecord,
  }
}
