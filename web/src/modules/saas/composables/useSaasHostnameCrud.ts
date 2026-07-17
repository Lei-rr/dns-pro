import { ref, h } from 'vue'
import { saasApi, preferredDomainApi } from '../utils/api'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'
import { showBatchFailures } from '@/shared/utils/batch'
import { useJobProgress } from '@/shared/composables/useJobProgress'
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
  const jobProgress = useJobProgress()

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

      // optimistic local patch first
      const hostname = editingHostname.value.hostname
      const idx = hostnames.value.findIndex((h) => h.hostname === hostname)
      const previous = idx >= 0 ? { ...hostnames.value[idx] } : null
      if (idx >= 0) {
        hostnames.value.splice(idx, 1, {
          ...hostnames.value[idx],
          preferred_domain: preferred,
          auto_preferred: !!formData.autoPreferred,
          custom_origin_server: String(payload.custom_origin_server || ''),
          custom_metadata: {
            ...(hostnames.value[idx].custom_metadata || {}),
            preferred_domain: preferred,
          },
        })
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
      if (showDetails.value && selectedHostname.value?.id === response.data?.id) {
        selectedHostname.value = { ...selectedHostname.value, ...response.data }
      }
    } catch (error) {
      // rollback optimistic patch on failure
      message.error(errorMessage(error))
      await load()
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

  async function askBatchUpdatePreferred() {
    if (!selectedHostnames.value.length) {
      message.warning('请先选择主机名')
      return
    }
    // reuse preferred list from API
    let domains: Array<{ domain: string }> = []
    try {
      const res = await preferredDomainApi.list()
      domains = (res.data || []) as Array<{ domain: string }>
    } catch {
      domains = []
    }
    if (!domains.length) {
      message.warning('还没有优选域名，请先在优选域名里添加')
      return
    }

    let selected = String(domains[0]?.domain || '')
    modal.confirm({
      title: '批量修改优选域名',
      content: h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [
        h('div', `将把已选 ${selectedHostnames.value.length} 个主机名的优选域名改为：`),
        h(
          'select',
          {
            style: 'width:100%;padding:6px 8px',
            onChange: (e: Event) => {
              selected = String((e.target as HTMLSelectElement).value || '')
            },
          },
          domains.map((item) => h('option', { value: item.domain, selected: item.domain === selected }, item.domain)),
        ),
      ]),
      okText: '开始修改',
      cancelText: '取消',
      onOk: async () => {
        if (!selected) {
          message.warning('请选择优选域名')
          return Promise.reject()
        }
        await batchUpdatePreferred(selected)
      },
    })
  }

  async function batchUpdatePreferred(preferred: string) {
    deleting.value = true
    deletingText.value = '正在创建批量修改任务...'
    try {
      const selected = selectedHostnames.value.map((item) => item.hostname).filter(Boolean)
      const created = await saasApi.batchUpdate(props.provider, decodedZoneName.value, {
        hostnames: selected,
        patch: {
          preferred_domain: preferred,
          auto_preferred: true,
        },
        auto_sync: true,
      })
      const jobId = String((created.data as any)?.id || '')
      if (!jobId) throw new Error('创建批量修改任务失败')

      const job = await jobProgress.pollJob(jobId, {
        fetchJob: async (id) => ((await saasApi.batchJob(id)).data as any) || {},
        onTick: (current) => {
          deletingText.value = current.current
            ? `后台修改 ${current.done || 0}/${current.total || 0}：${current.current}`
            : `后台修改 ${current.done || 0}/${current.total || 0}`
        },
      })

      const failedItems = jobProgress.failedItems(job)
      if (failedItems.length) {
        showBatchFailures(
          job?.message || '批量修改完成',
          failedItems.map((i: any) => `${i.hostname}: ${i.message || '失败'}`),
          '个',
        )
      } else {
        message.success(job?.message || '批量修改完成')
      }

      for (const item of (job?.items || []) as any[]) {
        if (item.status === 'success') {
          const idx = hostnames.value.findIndex((h: SaaSHostname) => h.hostname === item.hostname)
          if (idx >= 0) {
            hostnames.value.splice(idx, 1, {
              ...hostnames.value[idx],
              preferred_domain: preferred,
              auto_preferred: true,
              custom_metadata: {
                ...(hostnames.value[idx].custom_metadata || {}),
                preferred_domain: preferred,
              },
            })
          }
        }
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

  async function batchDeleteHostnames(dialog: ReturnType<typeof modal.confirm> | null, total: number) {
    deleting.value = true
    const deletingCurrent = selectedHostnames.value.some((record) => isCurrentHostname(record))
    try {
      deletingText.value = `正在创建批量删除任务 0/${total}`
      updateBatchDeleteDialog(dialog, total)
      const hostnames = selectedHostnames.value.map((item) => item.hostname).filter(Boolean)
      const created = await saasApi.batchDelete(props.provider, decodedZoneName.value, { hostnames })
      const jobId = String((created.data as any)?.id || '')
      if (!jobId) throw new Error('创建批量删除任务失败')

      const job = await jobProgress.pollJob(jobId, {
        fetchJob: async (id) => ((await saasApi.batchJob(id)).data as any) || {},
        onTick: (current) => {
          deletingText.value = current.current
            ? `后台删除 ${current.done || 0}/${current.total || total}：${current.current}`
            : `后台删除 ${current.done || 0}/${current.total || total}`
          updateBatchDeleteDialog(dialog, total)
        },
      })

      const failedItems = jobProgress.failedItems(job)
      if (failedItems.length) {
        showBatchFailures(
          job?.message || '批量删除完成',
          failedItems.map((i: any) => `${i.hostname}: ${i.message || '失败'}`),
          '个',
        )
      } else {
        message.success(job?.message || '批量删除完成')
      }

      if (deletingCurrent) {
        selectedHostname.value = null
        showDetails.value = false
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

  function mergeHostnameRecord(updated: SaaSHostname) {
    if (!updated?.id) return
    const index = hostnames.value.findIndex((item) => item.id === updated.id)
    if (index >= 0) hostnames.value.splice(index, 1, { ...hostnames.value[index], ...updated })
  }

  async function applyPreferredDomainToList(domain: string, options: { onlyAutoPreferred?: boolean; dryRun?: boolean } = {}) {
    const preferred = String(domain || '').trim()
    if (!preferred) {
      message.warning('请选择优选域名')
      return
    }
    if (!hostnames.value.length) {
      message.warning('当前列表没有可切换的主机名')
      return
    }

    applyingPreferred.value = true
    applyingPreferredText.value = options.dryRun ? '正在预览...' : '正在创建后台任务...'
    try {
      if (options.dryRun) {
        const preview = await saasApi.preferredApplyPreview(props.provider, decodedZoneName.value, {
          preferred_domain: preferred,
          only_auto_preferred: !!options.onlyAutoPreferred,
        })
        const data: any = preview.data || {}
        const will = Number(data.items?.filter?.((i: any) => i.will_change)?.length ?? data.total ?? 0)
        message.info(`预览：共 ${data.total ?? 0} 个主机，将切换 ${will} 个`)
        return
      }

      const created = await saasApi.preferredApply(props.provider, decodedZoneName.value, {
        preferred_domain: preferred,
        only_auto_preferred: !!options.onlyAutoPreferred,
      })
      const jobId = String((created.data as any)?.id || '')
      if (!jobId) {
        message.error('创建任务失败')
        return
      }

      // poll job until finished via shared helper
      let job = await jobProgress.pollJob(jobId, {
        fetchJob: async (id) => ((await saasApi.preferredApplyJob(id)).data as any) || {},
        onTick: (current) => {
          applyingPreferredText.value = current.current
            ? `后台切换 ${current.done || 0}/${current.total || 0}：${current.current}`
            : `后台切换 ${current.done || 0}/${current.total || 0}`
        },
      })

      const failedItems = jobProgress.failedItems(job)
      if (failedItems.length) {
        showBatchFailures(
          job?.message || '一键切换优选域名完成',
          failedItems.map((i: any) => `${i.hostname}: ${i.message || '失败'}`),
          '个',
        )
        modal.confirm({
          title: '重试失败项？',
          content: `有 ${failedItems.length} 个主机切换失败，是否仅重试失败项？`,
          okText: '重试失败项',
          onOk: async () => {
            applyingPreferred.value = true
            try {
              await saasApi.preferredApplyRetry(jobId)
              job = await jobProgress.pollJob(jobId, {
                fetchJob: async (id) => ((await saasApi.preferredApplyJob(id)).data as any) || {},
                onTick: (current) => {
                  applyingPreferredText.value = `重试 ${current.done || 0}/${current.total || 0}`
                },
              })
              message.success(job?.message || '重试完成')
              await load({ refresh: true })
            } catch (error) {
              message.error(errorMessage(error))
            } finally {
              applyingPreferred.value = false
              applyingPreferredText.value = ''
            }
          },
        })
      } else {
        message.success(job?.message || `已将当前列表切换为 ${preferred}`)
      }

      // optimistic local patch for success items, then soft refresh
      for (const item of (job?.items || []) as any[]) {
        if (item.status === 'success') {
          const idx = hostnames.value.findIndex((h) => h.hostname === item.hostname)
          if (idx >= 0) {
            hostnames.value.splice(idx, 1, {
              ...hostnames.value[idx],
              preferred_domain: preferred,
              auto_preferred: true,
              custom_metadata: {
                ...(hostnames.value[idx].custom_metadata || {}),
                preferred_domain: preferred,
              },
            })
          }
        }
      }
      await load({ refresh: true })
    } catch (error) {
      message.error(errorMessage(error))
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
    askBatchUpdatePreferred,
    applyPreferredDomainToList,
    mergeHostnameRecord,
  }
}
