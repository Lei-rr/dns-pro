import { ApiError } from '../../../lib/http/api-error.js'
import type { JobRecord } from '../../../contracts/index.js'
import type { JobService } from '../../../platform/job/job-service.js'
import type { CloudflareCustomHostname } from '../gateways/custom-hostname-gateway.js'
import { SaasWorkflowService } from './workflow-service.js'
import { SaasHostnameService } from './hostname-service.js'

export const PREFERRED_APPLY_JOB_TYPE = 'saas.preferred_apply'

/** API-facing job shape (keeps frontend fields stable). */
export type PreferredApplyJob = {
  id: string
  provider_id: string
  zone_name: string
  preferred_domain: string
  only_auto_preferred: boolean
  dry_run: boolean
  status: string
  total: number
  done: number
  success: number
  failed: number
  skipped: number
  current?: string
  items: Array<Record<string, unknown>>
  created_at: number
  updated_at: number
  finished_at?: number
  message?: string
}

/**
 * SaaS preferred-domain apply built on the generic JobService.
 */
export class SaasPreferredApplyService {
  constructor(
    private readonly jobs: JobService,
    private readonly workflow: SaasWorkflowService,
    private readonly hostnames: SaasHostnameService,
  ) {
    this.jobs.registerRunner(PREFERRED_APPLY_JOB_TYPE, (job) => this.runJob(job))
  }

  async preview(input: {
    providerId: string
    zoneName: string
    preferredDomain: string
    hostnames?: string[]
    onlyAutoPreferred?: boolean
  }) {
    const preferred = String(input.preferredDomain || '').trim()
    if (!preferred) throw new ApiError('preferred_domain_invalid', 'Preferred domain is required', 422)

    const list = await this.resolveTargets(input.providerId, input.zoneName, input.hostnames, !!input.onlyAutoPreferred)
    return {
      preferred_domain: preferred,
      only_auto_preferred: !!input.onlyAutoPreferred,
      total: list.length,
      items: list.map((item) => {
        const current = this.currentPreferred(item)
        return {
          hostname: item.hostname,
          current_preferred: current,
          auto_preferred: !!(item as any).auto_preferred,
          will_change: current !== preferred,
        }
      }),
    }
  }

  async create(input: {
    providerId: string
    zoneName: string
    preferredDomain: string
    hostnames?: string[]
    onlyAutoPreferred?: boolean
    dryRun?: boolean
  }): Promise<PreferredApplyJob> {
    const preferred = String(input.preferredDomain || '').trim()
    if (!preferred) throw new ApiError('preferred_domain_invalid', 'Preferred domain is required', 422)

    const active = await this.findActive(input.providerId, input.zoneName)
    if (active) {
      throw new ApiError('preferred_apply_running', 'A preferred-domain apply job is already running', 409, {
        job_id: active.id,
      })
    }

    const targets = await this.resolveTargets(
      input.providerId,
      input.zoneName,
      input.hostnames,
      !!input.onlyAutoPreferred,
    )
    if (!targets.length) {
      throw new ApiError('preferred_apply_empty', 'No hostnames matched for preferred-domain apply', 422)
    }

    const payload = {
      provider_id: input.providerId,
      zone_name: input.zoneName,
      preferred_domain: preferred,
      only_auto_preferred: !!input.onlyAutoPreferred,
      dry_run: !!input.dryRun,
    }

    const items = targets.map((t) => ({
      hostname: t.hostname,
      preferred_domain: preferred,
      current_preferred: this.currentPreferred(t),
      auto_preferred: !!(t as any).auto_preferred,
    }))

    if (input.dryRun) {
      const job = await this.jobs.create(PREFERRED_APPLY_JOB_TYPE, payload, items, {
        start: false,
        message: '预览任务已创建',
      })
      const dryItems = items.map((item) => {
        const willChange = String(item.current_preferred || '') !== preferred
        return {
          ...item,
          status: willChange ? 'success' : 'skipped',
          message: willChange ? `将切换为 ${preferred}` : '已是目标优选域名',
        }
      })
      const success = dryItems.filter((i) => i.status === 'success').length
      const skipped = dryItems.filter((i) => i.status === 'skipped').length
      const updated = await this.jobs.patch(job.id, {
        status: 'completed',
        items: dryItems,
        done: dryItems.length,
        success,
        skipped,
        failed: 0,
        finished_at: Date.now(),
        message: `预览完成：将切换 ${success} 个，跳过 ${skipped} 个`,
      })
      return this.present(updated!)
    }

    const job = await this.jobs.create(PREFERRED_APPLY_JOB_TYPE, payload, items, {
      message: '任务已创建，等待后台执行',
    })
    return this.present(job)
  }

  async find(id: string): Promise<PreferredApplyJob | null> {
    const job = await this.jobs.get(id)
    if (!job || job.type !== PREFERRED_APPLY_JOB_TYPE) return null
    return this.present(job)
  }

  async active(providerId: string, zoneName: string): Promise<PreferredApplyJob | null> {
    return this.findActive(providerId, zoneName)
  }

  async retryFailed(jobId: string): Promise<PreferredApplyJob> {
    const job = await this.require(jobId)
    const failed = job.items.filter((i) => i.status === 'failed')
    if (!failed.length) throw new ApiError('preferred_apply_no_failed', 'No failed items to retry', 422)

    const items = job.items.map((item) =>
      item.status === 'failed' ? { ...item, status: 'pending', message: undefined } : item,
    )
    const done = items.filter((i) => ['success', 'skipped'].includes(String(i.status))).length
    const requeued = await this.jobs.requeue(jobId, {
      items,
      done,
      failed: 0,
      success: items.filter((i) => i.status === 'success').length,
      skipped: items.filter((i) => i.status === 'skipped').length,
      message: '失败项重试中',
    })
    return this.present(requeued)
  }

  private async runJob(job: JobRecord): Promise<void> {
    const payload = (job.payload || {}) as Record<string, unknown>
    if (payload.dry_run) return

    const providerId = String(payload.provider_id || '')
    const zoneName = String(payload.zone_name || '')
    const preferred = String(payload.preferred_domain || '')

    for (const raw of job.items) {
      const item = raw as Record<string, unknown>
      const hostname = String(item.hostname || '')
      if (!hostname) continue
      if (item.status === 'success' || item.status === 'skipped') continue

      await this.jobs.patchItem(
        job.id,
        (row) => String(row.hostname || '') === hostname,
        { status: 'running', message: '处理中' },
        { current: hostname, message: '后台执行中' },
      )

      try {
        await this.workflow.updateHostname(
          providerId,
          zoneName,
          hostname,
          {
            preferred_domain: preferred,
            auto_preferred: true,
          },
          true,
        )
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.hostname || '') === hostname,
          {
            status: 'success',
            message: `已切换为 ${preferred}`,
            preferred_domain: preferred,
          },
        )
      } catch (error) {
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.hostname || '') === hostname,
          {
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }

    const finalJob = await this.jobs.get(job.id)
    if (!finalJob) return
    const success = finalJob.items.filter((i) => i.status === 'success').length
    const failed = finalJob.items.filter((i) => i.status === 'failed').length
    const skipped = finalJob.items.filter((i) => i.status === 'skipped').length
    await this.jobs.patch(job.id, {
      status: failed > 0 && success === 0 ? 'failed' : 'completed',
      success,
      failed,
      skipped,
      done: finalJob.items.length,
      current: undefined,
      finished_at: Date.now(),
      message: failed
        ? `完成：成功 ${success}，失败 ${failed}，跳过 ${skipped}`
        : `完成：成功 ${success}，跳过 ${skipped}`,
    })
  }

  private async resolveTargets(
    providerId: string,
    zoneName: string,
    hostnames?: string[],
    onlyAutoPreferred = false,
  ): Promise<CloudflareCustomHostname[]> {
    const listing = await this.hostnames.hostnames(providerId, zoneName, 1, 200, false)
    let items = listing.items ?? []
    if (hostnames?.length) {
      const set = new Set(hostnames.map((h) => h.toLowerCase().trim()))
      items = items.filter((item) => set.has(String(item.hostname || '').toLowerCase()))
    }
    if (onlyAutoPreferred) {
      items = items.filter((item) => !!(item as any).auto_preferred)
    }
    return items
  }

  private currentPreferred(item: CloudflareCustomHostname): string {
    return String((item as any).preferred_domain ?? item.custom_metadata?.preferred_domain ?? '')
  }

  private async findActive(providerId: string, zoneName: string): Promise<PreferredApplyJob | null> {
    const actives = await this.jobs.listActive(PREFERRED_APPLY_JOB_TYPE)
    const hit = actives.find((job) => {
      const payload = job.payload || {}
      return payload.provider_id === providerId && payload.zone_name === zoneName
    })
    return hit ? this.present(hit) : null
  }

  private async require(id: string): Promise<PreferredApplyJob> {
    const job = await this.find(id)
    if (!job) throw new ApiError('preferred_apply_not_found', 'Preferred apply job not found', 404, { job_id: id })
    return job
  }

  private present(job: JobRecord): PreferredApplyJob {
    const payload = (job.payload || {}) as Record<string, unknown>
    return {
      id: job.id,
      provider_id: String(payload.provider_id || ''),
      zone_name: String(payload.zone_name || ''),
      preferred_domain: String(payload.preferred_domain || ''),
      only_auto_preferred: Boolean(payload.only_auto_preferred),
      dry_run: Boolean(payload.dry_run),
      status: job.status,
      total: job.total,
      done: job.done,
      success: job.success,
      failed: job.failed,
      skipped: job.skipped,
      current: job.current,
      items: job.items,
      created_at: job.created_at,
      updated_at: job.updated_at,
      finished_at: job.finished_at,
      message: job.message,
    }
  }
}
