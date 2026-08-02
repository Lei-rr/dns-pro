import { ApiError } from '../../shared/http/api-error.js'
import type { JobRecord } from '../../platform/jobs/job.types.js'
import type { JobService } from '../../platform/jobs/job.service.js'
import type { CloudflareCustomHostname } from '../../modules/saas/saas-custom-hostname.client.js'
import {
  type BatchJobViewBase,
  findActiveBatchJob,
  finishBatchJob,
  presentBatchJobBase,
  requeueFailedBatchItems,
  runBatchItems,
} from '../../platform/jobs/batch-helpers.js'
import { PREFERRED_APPLY_JOB_TYPE, SAAS_ZONE_JOB_TYPES } from './saas-dns-sync-job.types.js'
import { SaaSDnsSyncWorkflow } from './saas-dns-sync.workflow.js'
import { SaaSHostnameService } from '../../modules/saas/saas-hostname.service.js'

/** API-facing job shape (keeps frontend fields stable). */
export type PreferredApplyJob = BatchJobViewBase & {
  provider_id: string
  zone_name: string
  preferred_domain: string
  only_auto_preferred: boolean
  dry_run: boolean
}

/**
 * SaaS preferred-domain apply on JobService (same zone lock as SaaS batch).
 */
export class SaaSPreferredApplyWorkflow {
  constructor(
    private readonly jobs: JobService,
    private readonly workflow: SaaSDnsSyncWorkflow,
    private readonly hostnames: SaaSHostnameService
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
          auto_preferred: !!(item as CloudflareCustomHostname).auto_preferred,
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

    const targets = await this.resolveTargets(
      input.providerId,
      input.zoneName,
      input.hostnames,
      !!input.onlyAutoPreferred
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
      auto_preferred: !!(t as CloudflareCustomHostname).auto_preferred,
    }))

    if (input.dryRun) {
      const dryItems = items.map((item) => {
        const willChange = String(item.current_preferred || '') !== preferred
        return {
          ...item,
          status: willChange ? 'success' : 'skipped',
          message: willChange ? `将切换为 ${preferred}` : '已是目标优选域名',
        }
      })
      const success = dryItems.filter((item) => item.status === 'success').length
      const skipped = dryItems.filter((item) => item.status === 'skipped').length
      const job = await this.jobs.createTerminalExclusive(
        PREFERRED_APPLY_JOB_TYPE,
        payload,
        dryItems,
        {
          types: [...SAAS_ZONE_JOB_TYPES],
          scope: { provider_id: input.providerId, zone_name: input.zoneName },
          message: 'A SaaS batch or preferred-domain apply job is already running for this zone',
        },
        {
          status: 'completed',
          success,
          skipped,
          failed: 0,
          message: `预览完成：将切换 ${success} 个，跳过 ${skipped} 个`,
        }
      )
      return this.present(job)
    }

    const job = await this.jobs.createExclusive(
      PREFERRED_APPLY_JOB_TYPE,
      payload,
      items,
      {
        types: [...SAAS_ZONE_JOB_TYPES],
        scope: { provider_id: input.providerId, zone_name: input.zoneName },
        message: 'A SaaS batch or preferred-domain apply job is already running for this zone',
      },
      { message: '任务已创建，等待后台执行' }
    )
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
    await this.require(jobId)
    const raw = await this.jobs.get(jobId)
    if (!raw) throw new ApiError('preferred_apply_not_found', 'Preferred apply job not found', 404, { job_id: jobId })
    const payload = raw.payload || {}
    const requeued = await requeueFailedBatchItems(this.jobs, raw, {
      types: [...SAAS_ZONE_JOB_TYPES],
      scope: { provider_id: String(payload.provider_id || ''), zone_name: String(payload.zone_name || '') },
      message: 'A SaaS batch or preferred-domain apply job is already running for this zone',
    })
    return this.present(requeued)
  }

  private async runJob(job: JobRecord): Promise<void> {
    const payload = (job.payload || {}) as Record<string, unknown>
    if (payload.dry_run) return

    const providerId = String(payload.provider_id || '')
    const zoneName = String(payload.zone_name || '')
    const preferred = String(payload.preferred_domain || '')

    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.hostname || ''),
      runningMessage: '处理中',
      progressMessage: '后台执行中',
      execute: async (_item, hostname) => {
        const updated = await this.workflow.updateHostname(
          providerId,
          zoneName,
          hostname,
          {
            preferred_domain: preferred,
            auto_preferred: true,
          },
          true
        )

        const dnsSync = (updated as { side_effects?: { dns?: { sync?: { status?: string; message?: string } } } })
          ?.side_effects?.dns?.sync
        if (dnsSync && dnsSync.status === 'failed') {
          return {
            status: 'failed',
            message: `优选已保存，但 DNS 写回失败：${dnsSync.message || '未知错误'}`,
            extra: { preferred_domain: preferred, dns_sync_status: 'failed' },
          }
        }

        const dnsNote =
          dnsSync?.status === 'skipped'
            ? `（DNS 跳过：${dnsSync.message || '已跳过'}）`
            : dnsSync?.status === 'completed'
              ? '（DNS 已写回）'
              : ''

        return {
          status: 'success',
          message: `已切换为 ${preferred}${dnsNote}`,
          extra: {
            preferred_domain: preferred,
            dns_sync_status: dnsSync?.status || 'unknown',
          },
        }
      },
    })

    await finishBatchJob(this.jobs, job.id, '优选应用')
  }

  private async resolveTargets(
    providerId: string,
    zoneName: string,
    hostnames?: string[],
    onlyAutoPreferred = false
  ): Promise<CloudflareCustomHostname[]> {
    let items = await this.hostnames.allHostnames(providerId, zoneName)
    if (hostnames?.length) {
      const set = new Set(hostnames.map((h) => h.toLowerCase().trim()))
      items = items.filter((item) => set.has(String(item.hostname || '').toLowerCase()))
    }
    if (onlyAutoPreferred) {
      items = items.filter((item) => !!item.auto_preferred)
    }
    return items
  }

  private currentPreferred(item: CloudflareCustomHostname): string {
    return String(item.preferred_domain ?? item.custom_metadata?.preferred_domain ?? '')
  }

  private async findActive(providerId: string, zoneName: string): Promise<PreferredApplyJob | null> {
    const hit = await findActiveBatchJob(this.jobs, [...SAAS_ZONE_JOB_TYPES], {
      provider_id: providerId,
      zone_name: zoneName,
    })
    return hit ? this.present(hit) : null
  }

  private async require(id: string): Promise<PreferredApplyJob> {
    const job = await this.find(id)
    if (!job) throw new ApiError('preferred_apply_not_found', 'Preferred apply job not found', 404, { job_id: id })
    return job
  }

  private present(job: JobRecord): PreferredApplyJob {
    const base = presentBatchJobBase(job)
    const payload = (job.payload || {}) as Record<string, unknown>
    return {
      ...base,
      provider_id: String(payload.provider_id || ''),
      zone_name: String(payload.zone_name || ''),
      preferred_domain: String(payload.preferred_domain || ''),
      only_auto_preferred: Boolean(payload.only_auto_preferred),
      dry_run: Boolean(payload.dry_run),
    }
  }
}
