import { ref } from 'vue'
import type { ApiResponse } from '@/shared/api/types'
import { saasApi } from '@/features/saas/api/saas-api'
import type { JobLike } from '@/shared/job'
import { formatFailedJobItem, runBatchJob, showBatchFailures, useJobProgress } from '@/shared/job'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { createScopeGeneration, type ScopeOwner } from '@/shared/lib/scope-generation'

export type SaasScope = { providerId: string; zoneName: string }

/** 探测超时：上游慢时快速降级成「未发现进行中任务」，不让后台探测占住面板读路径 */
const PROBE_TIMEOUT_MS = 4000
/** 「未发现进行中任务」结论的复用窗口：窗口内重复进入同一面板不再重复探测 */
const PROBE_MISS_TTL_MS = 10_000
const probeMisses = new Map<string, number>()

/**
 * 探测失败或超时的统一降级：按「未发现任务」返回，不抛错也不重试。
 * 探测只是后台恢复逻辑，失败时不打扰用户，也不为它在慢上游上叠加请求。
 */
async function probeActive(run: () => Promise<ApiResponse<unknown>>): Promise<{ data?: unknown }> {
  try {
    return { data: (await run())?.data ?? null }
  } catch {
    return { data: null }
  }
}

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
      // dry_run 不再是创建端点的语义：预览单独走 preview 端点，创建体里不能出现该字段
      const body = {
        preferred_domain: payload.domain,
        only_auto_preferred: !!payload.onlyAutoPreferred,
      }
      if (payload.dryRun) {
        const preview = await saasApi.preferredApplyPreview(
          scopeOwner.value.providerId,
          scopeOwner.value.zoneName,
          body
        )
        if (!owner.active() || !scopeOwner.active()) return
        const data = (preview.data || {}) as Record<string, unknown>
        toast.message('预览完成', `将变更 ${Number(data.will_change ?? data.total ?? 0)} 项`)
        return
      }
      await runBatchJob({
        label: '后台切换',
        create: () =>
          scopeOwner.active()
            ? saasApi.preferredApply(scopeOwner.value.providerId, scopeOwner.value.zoneName, body)
            : Promise.resolve({ data: undefined }),
        fetchJob: async (id) => (await saasApi.preferredApplyJob(scopeOwner.value.providerId, id)).data,
        retry: (id) => saasApi.preferredApplyRetry(scopeOwner.value.providerId, id),
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
      fetchJob: async (id) => (await saasApi.batchJob(scopeOwner.value.providerId, id)).data,
      retry: (id) => saasApi.batchRetry(scopeOwner.value.providerId, id),
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
    const scopeKey = `${options.providerId()}|${options.zoneName()}`
    const probedAt = probeMisses.get(scopeKey)
    // 进入面板即探测会连带触发上游主机名全量加载：刚探测过的结论直接复用，不重复付这份代价
    if (probedAt && Date.now() - probedAt < PROBE_MISS_TTL_MS) return
    const fetchers: Array<{
      label: string
      fetchActive: () => Promise<{ data?: unknown }>
      fetchJob: (id: string) => Promise<JobLike | null>
      retry: (id: string) => Promise<unknown>
    }> = [
      {
        label: '优选切换',
        fetchActive: () =>
          probeActive(() =>
            saasApi.preferredApplyActive(options.providerId(), options.zoneName(), { timeout: PROBE_TIMEOUT_MS })
          ),
        fetchJob: async (id) => (await saasApi.preferredApplyJob(options.providerId(), id)).data,
        retry: (id) => saasApi.preferredApplyRetry(options.providerId(), id),
      },
      {
        label: 'SaaS 批量',
        fetchActive: () =>
          probeActive(() =>
            saasApi.batchActive(options.providerId(), options.zoneName(), { timeout: PROBE_TIMEOUT_MS })
          ),
        fetchJob: async (id) => (await saasApi.batchJob(options.providerId(), id)).data,
        retry: (id) => saasApi.batchRetry(options.providerId(), id),
      },
    ]
    let resumed = false
    for (const item of fetchers) {
      if (!owner.active()) return
      const finished = await jobProgress.resumeActive(item.fetchActive, { label: item.label, fetchJob: item.fetchJob })
      if (!owner.active()) return
      if (!finished) continue
      resumed = true
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
    // 两族都未发现进行中任务：记下结论，窗口内重复进入面板不再重复探测
    if (!resumed && owner.active()) probeMisses.set(scopeKey, Date.now())
  }

  function reset() {
    resumeOwnership.invalidate()
    applyOwnership.invalidate()
    applyingPreferred.value = false
    jobProgress.reset()
  }

  return { jobProgress, applyingPreferred, applyPreferred, runBatch, resume, reset }
}
