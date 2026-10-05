import { reactive, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { batchJobFetcher, batchJobRetrier, dnsApi, type DnsProviderRef, type DnsRecordBatchPatch } from '../api/dns-api'
import type { DnsRecord } from '../model/types'
import type { ImportPlan } from '../lib/record-import-preview'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { formatFailedJobItem, runBatchJob, showBatchFailures, type useJobProgress } from '@/shared/job'
import { confirmDialog } from '@/shared/ui/confirm'
import { createScopeGeneration } from '@/shared/lib/scope-generation'

export type BatchPatchState = {
  value: string
  ttl: string
  line: string
  remark: string
  priority: string
  proxied: '__keep' | 'true' | 'false'
}

/** 批量删除 / 批量修改 / 导入覆盖：全部经后台批量任务，写后统一 invalidate。 */
export function useRecordsBatch(options: {
  provider: MaybeRefOrGetter<DnsProviderRef>
  zoneId: MaybeRefOrGetter<string>
  zoneName: MaybeRefOrGetter<string>
  lineIdOf: (line: string) => string | undefined
  jobProgress: ReturnType<typeof useJobProgress>
  invalidate: () => Promise<void>
  selectedRows: () => DnsRecord[]
  clearSelection: () => void
}) {
  const scope = createScopeGeneration()
  const batchEditOpen = ref(false)
  const batchSubmitting = ref(false)
  const batchEditError = ref('')
  const importOpen = ref(false)
  const importSubmitting = ref(false)
  const batchPatch = reactive<BatchPatchState>({
    value: '',
    ttl: '',
    line: '__keep',
    remark: '',
    priority: '',
    proxied: '__keep',
  })

  function selected(): DnsRecord[] {
    return options.selectedRows()
  }

  function openBatchEdit() {
    if (!selected().length) {
      toast.warning('请先勾选记录')
      return
    }
    batchPatch.value = ''
    batchPatch.ttl = ''
    batchPatch.line = '__keep'
    batchPatch.remark = ''
    batchPatch.priority = ''
    batchPatch.proxied = '__keep'
    batchEditError.value = ''
    batchEditOpen.value = true
  }

  async function runDnsBatch(create: () => Promise<{ data?: unknown }>, label: string) {
    const provider = toValue(options.provider)
    return runBatchJob({
      label,
      create,
      fetchJob: batchJobFetcher(provider),
      retry: batchJobRetrier(provider),
      clearSelection: () => options.clearSelection(),
      onDone: () => options.invalidate(),
      jobProgress: options.jobProgress,
    })
  }

  async function batchDeleteSelected() {
    const rows = selected()
    if (!rows.length) {
      toast.warning('请先勾选记录')
      return
    }
    // 确认弹窗期间可能切换 provider/zone：先快照作用域，请求只用快照值
    const scopeOwner = scope.capture({ provider: toValue(options.provider), zoneId: toValue(options.zoneId) })
    if (
      !(await confirmDialog({
        title: '批量删除',
        description: `确认删除已选 ${rows.length} 条记录？`,
        confirmText: '删除',
        destructive: true,
      }))
    )
      return
    if (!scopeOwner.active()) return
    const payload = rows
      .map((row) => ({ id: String(row.id || ''), name: String(row.name || ''), type: String(row.type || '') }))
      .filter((row) => row.id)
    if (!payload.length) return
    const { provider, zoneId } = scopeOwner.value
    try {
      await runDnsBatch(() => dnsApi.batchDeleteRecords(provider, zoneId, { records: payload }), '批量删除')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function batchUpdateSelected() {
    if (batchSubmitting.value) return
    const provider = toValue(options.provider)
    const zoneId = toValue(options.zoneId)
    const rows = selected()
    const patch: DnsRecordBatchPatch = {}
    let invalid = ''
    if (batchPatch.value.trim()) patch.value = batchPatch.value.trim()
    if (batchPatch.ttl.trim()) {
      const ttlNum = Number(batchPatch.ttl)
      if (Number.isFinite(ttlNum) && ttlNum > 0) patch.ttl = ttlNum
      else invalid = 'TTL 需为正整数'
    }
    if (batchPatch.line && batchPatch.line !== '__keep') {
      patch.line = batchPatch.line
      patch.record_line_id = options.lineIdOf(batchPatch.line)
    }
    if (batchPatch.remark.trim()) patch.remark = batchPatch.remark.trim()
    if (batchPatch.priority.trim()) {
      const prioNum = Number(batchPatch.priority)
      if (Number.isFinite(prioNum)) patch.priority = prioNum
      else invalid = '优先级需为数字'
    }
    if (batchPatch.proxied === 'true' || batchPatch.proxied === 'false') {
      patch.proxied = batchPatch.proxied === 'true'
    }
    batchEditError.value = invalid || (Object.keys(patch).length ? '' : '请至少填写一项要修改的字段')
    if (batchEditError.value) return
    const payload = rows.map((row) => ({
      id: String(row.id || ''),
      name: String(row.name || ''),
      type: String(row.type || ''),
      value: String(row.value || row.content || ''),
      ttl: row.ttl,
      line: row.line,
      remark: row.remark || row.comment,
      priority: row.priority ?? row.mx,
      proxied: row.proxied,
      // 与单条编辑同约定：必须回传启停状态与权重，否则会被上游重置（停用记录被启用、权重归零）
      status: String(row.status || '').toUpperCase() || undefined,
      weight: row.weight,
    }))
    if (!payload.length) return
    batchSubmitting.value = true
    batchEditOpen.value = false
    try {
      await runDnsBatch(() => dnsApi.batchUpdateRecords(provider, zoneId, { records: payload, patch }), '批量修改')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      batchSubmitting.value = false
    }
  }

  /** F4：导入计划 = 批量新增 + 已确认的逐条覆盖 */
  async function submitImport(plan: ImportPlan) {
    importSubmitting.value = true
    importOpen.value = false
    const provider = toValue(options.provider)
    const zoneId = toValue(options.zoneId)
    const zoneName = toValue(options.zoneName)
    try {
      const failures: string[] = []
      for (const item of plan.overwritten) {
        try {
          await dnsApi.updateRecord(
            provider,
            zoneId,
            String(item.existing.id),
            {
              name: item.incoming.name,
              type: item.incoming.type,
              value: item.incoming.value,
              ttl: item.incoming.ttl,
              line: item.incoming.line,
              priority: item.incoming.priority,
              remark: item.incoming.remark,
              proxied: item.incoming.proxied,
              // 覆盖不清除启停状态与权重：与单条编辑同约定，漏传会被上游重置
              status: String(item.existing.status || '').toUpperCase() || undefined,
              weight: item.existing.weight,
            },
            { zoneName }
          )
        } catch (error) {
          failures.push(`${item.incoming.name} · ${item.incoming.type}：${errorMessage(error)}`)
        }
      }
      if (failures.length) toast.error(`覆盖失败 ${failures.length} 条`, failures[0])
      else if (plan.overwritten.length) toast.success(`已覆盖 ${plan.overwritten.length} 条记录`)

      if (plan.added.length) {
        try {
          await runDnsBatch(() => dnsApi.batchCreateRecords(provider, zoneId, { records: plan.added }), '批量导入')
        } catch (error) {
          // 调用方以 void 触发，这里必须兜住，否则只有未处理的 rejection 而没有提示
          toast.error(errorMessage(error))
        }
      } else {
        await options.invalidate()
      }
    } finally {
      importSubmitting.value = false
    }
  }

  async function resumeJobs() {
    if (options.jobProgress.running.value) return
    // 用 capture 而不是 claim：claim 会作废仍在探测中的上一次恢复，
    // 两次恢复重叠时最新作用域的后台任务会被静默丢弃；作用域切换统一由 invalidateScope 作废
    const owner = scope.capture({ provider: toValue(options.provider), zoneId: toValue(options.zoneId) })
    const { provider, zoneId } = owner.value
    // 详情缺失（null/{}）由轮询层按未知状态上报：读不到任务详情时不会在这里被当成「已完成」去刷新列表
    const finished = await options.jobProgress.resumeActive(() => dnsApi.batchActive(provider, zoneId), {
      label: 'DNS 批量',
      fetchJob: batchJobFetcher(provider),
    })
    if (!owner.active() || !finished) return
    const jobId = String(finished.id || '')
    const failed = options.jobProgress.failedItems(finished)
    if (failed.length) {
      await showBatchFailures(
        finished.message || 'DNS 批量完成',
        failed.map((item) => formatFailedJobItem(item)),
        '条',
        {
          onRetry: async () => {
            if (!owner.active()) return null
            await dnsApi.batchRetry(provider, jobId)
            if (!owner.active()) return null
            return options.jobProgress.pollJob(jobId, {
              label: 'DNS 批量',
              fetchJob: batchJobFetcher(provider),
            })
          },
          isActive: () => owner.active(),
        }
      )
    }
    await options.invalidate()
  }

  /** 作用域切换（provider/zone 变化）时作废在飞的任务恢复流程 */
  function invalidateScope() {
    scope.invalidate()
  }

  return {
    batchEditOpen,
    batchPatch,
    batchSubmitting,
    batchEditError,
    importOpen,
    importSubmitting,
    openBatchEdit,
    batchUpdateSelected,
    batchDeleteSelected,
    submitImport,
    resumeJobs,
    invalidateScope,
  }
}
