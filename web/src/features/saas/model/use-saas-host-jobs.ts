import { ref } from 'vue'
import type { ApiResponse } from '@/shared/api/types'
import { saasApi } from '@/features/saas/api/saas-api'
import type { JobLike } from '@/shared/job'
import { formatFailedJobItem, runBatchJob, showBatchFailures, useJobProgress } from '@/shared/job'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { createScopeGeneration, type ScopeOwner } from '@/shared/lib/scope-generation'

export type SaasScope = { providerId: string; zoneName: string }

export function useSaasHostJobs(options: {
  providerId: () => string
  zoneName: () => string
  reload: () => Promise<void>
  clearSelection: () => void
}) {
  const jobProgress = useJobProgress()
  const applyingPreferred = ref(false)
  const resumeOwnership = createScopeGeneration()
  const applyOwnership = createScopeGeneration()

  async function applyPreferred(
    scopeOwner: ScopeOwner<SaasScope>,
    payload: { domain: string; onlyAutoPreferred?: boolean; dryRun?: boolean }
  ) {
    if (!scopeOwner.active()) return
    const owner = applyOwnership.claim()
    applyingPreferred.value = true
    try {
      const body = {
        preferred_domain: payload.domain,
        only_auto_preferred: !!payload.onlyAutoPreferred,
        dry_run: !!payload.dryRun,
      }
      if (payload.dryRun) {
        if (!scopeOwner.active()) return
        const preview = await saasApi.preferredApplyPreview(
          scopeOwner.value.providerId,
          scopeOwner.value.zoneName,
          body
        )
        if (!owner.active() || !scopeOwner.active()) return
        const data = (preview.data || {}) as Record<string, unknown>
        toast.message('预览完成', `将变更 ${Number(data.will_change || data.total || 0)} 项`)
        return
      }
      await runBatchJob({
        label: '后台切换',
        create: () =>
          scopeOwner.active()
            ? saasApi.preferredApply(scopeOwner.value.providerId, scopeOwner.value.zoneName, body)
            : Promise.resolve({ data: undefined }),
        fetchJob: async (id) => ((await saasApi.preferredApplyJob(id)).data as Record<string, unknown>) || {},
        retry: (id) => saasApi.preferredApplyRetry(id),
        onDone: () => (scopeOwner.active() ? options.reload() : undefined),
        failureUnit: '个',
        jobProgress,
      })
    } catch (error) {
      if (owner.active() && scopeOwner.active()) toast.error(errorMessage(error))
    } finally {
      if (owner.active() && scopeOwner.active()) applyingPreferred.value = false
    }
  }

  async function runBatch(scopeOwner: ScopeOwner<SaasScope>, create: () => Promise<{ data?: unknown }>, label: string) {
    if (!scopeOwner.active()) return null
    return runBatchJob({
      label,
      create: () => (scopeOwner.active() ? create() : Promise.resolve({ data: undefined })),
      fetchJob: async (id) => ((await saasApi.batchJob(id)).data as Record<string, unknown>) || {},
      retry: (id) => saasApi.batchRetry(id),
      clearSelection: () => {
        if (scopeOwner.active()) options.clearSelection()
      },
      onDone: () => (scopeOwner.active() ? options.reload() : undefined),
      failureUnit: '个',
      jobProgress,
    })
  }

  async function resume() {
    if (jobProgress.running.value) return
    const owner = resumeOwnership.claim()
    const fetchers: Array<{
      label: string
      fetchActive: () => Promise<ApiResponse<unknown>>
      fetchJob: (id: string) => Promise<JobLike>
      retry: (id: string) => Promise<unknown>
    }> = [
      {
        label: '优选切换',
        fetchActive: () => saasApi.preferredApplyActive(options.providerId(), options.zoneName()),
        fetchJob: async (id) => ((await saasApi.preferredApplyJob(id)).data as JobLike) || {},
        retry: (id) => saasApi.preferredApplyRetry(id),
      },
      {
        label: 'SaaS 批量',
        fetchActive: () => saasApi.batchActive(options.providerId(), options.zoneName()),
        fetchJob: async (id) => ((await saasApi.batchJob(id)).data as JobLike) || {},
        retry: (id) => saasApi.batchRetry(id),
      },
    ]
    for (const item of fetchers) {
      if (!owner.active()) return
      const finished = await jobProgress.resumeActive(item.fetchActive, { label: item.label, fetchJob: item.fetchJob })
      if (!owner.active()) return
      if (!finished) continue
      const failed = jobProgress.failedItems(finished)
      if (failed.length) {
        await showBatchFailures(
          finished.message || `${item.label}完成`,
          failed.map((entry) => formatFailedJobItem(entry)),
          '个',
          {
            onRetry: async () => {
              if (!owner.active()) return null
              const id = String(finished.id || '')
              await item.retry(id)
              if (!owner.active()) return null
              return jobProgress.pollJob(id, { label: item.label, fetchJob: item.fetchJob })
            },
            isActive: () => owner.active(),
          }
        )
      }
      if (!owner.active()) return
      await options.reload()
      break
    }
  }

  function reset() {
    resumeOwnership.invalidate()
    applyOwnership.invalidate()
    applyingPreferred.value = false
    jobProgress.reset()
  }

  return { jobProgress, applyingPreferred, applyPreferred, runBatch, resume, reset }
}
