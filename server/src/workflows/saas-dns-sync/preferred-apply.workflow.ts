import { ApiError } from '../../shared/http/api-error.js'
import type { JobService } from '../../platform/jobs/job.service.js'
import type { JobRecord } from '../../platform/jobs/job.types.js'
import {
  BatchJobKind,
  dnsEffectNote,
  dnsEffectOf,
  finishBatchJob,
  runBatchItems,
  type BatchJobViewBase,
} from '../../platform/jobs/batch-job.js'
import type { CloudflareCustomHostname } from '../../modules/saas/saas-custom-hostname.client.js'
import type { SaaSHostnameService } from '../../modules/saas/saas-hostname.service.js'
import {
  PREFERRED_APPLY_JOB,
  SAAS_ZONE_LOCK_MESSAGE,
  ZONE_WRITE_JOB_TYPES,
  readResourceKeys,
} from '../../platform/jobs/job-types.js'
import type { SaaSDnsSyncWorkflow } from './saas-dns-sync.workflow.js'

type PreferredApplyJob = BatchJobViewBase & {
  provider_id: string
  zone_name: string
  preferred_domain: string
  only_auto_preferred: boolean
  dry_run: boolean
}

type ApplyInput = {
  providerId: string
  zoneName: string
  preferredDomain: string
  hostnames?: string[]
  onlyAutoPreferred?: boolean
  dryRun?: boolean
}

const currentPreferred = (item: CloudflareCustomHostname) =>
  String(item.preferred_domain ?? item.custom_metadata?.preferred_domain ?? '')

/** 优选域名一键切换（与 SaaS 批量共用站点互斥锁） */
export class SaaSPreferredApplyWorkflow {
  private readonly kind: BatchJobKind<PreferredApplyJob>

  constructor(
    private readonly jobs: JobService,
    private readonly workflow: SaaSDnsSyncWorkflow,
    private readonly hostnames: SaaSHostnameService
  ) {
    this.kind = new BatchJobKind(jobs, {
      types: [PREFERRED_APPLY_JOB],
      lockTypes: ZONE_WRITE_JOB_TYPES,
      scopeKeys: ['provider_id', 'zone_name'],
      resourceKeys: readResourceKeys,
      lockMessage: SAAS_ZONE_LOCK_MESSAGE,
      notFoundCode: 'preferred_apply_not_found',
      present: (job, base) => ({
        ...base,
        provider_id: String(job.payload.provider_id ?? ''),
        zone_name: String(job.payload.zone_name ?? ''),
        preferred_domain: String(job.payload.preferred_domain ?? ''),
        only_auto_preferred: Boolean(job.payload.only_auto_preferred),
        dry_run: Boolean(job.payload.dry_run),
      }),
    })
    jobs.registerRunner(PREFERRED_APPLY_JOB, (job) => this.runJob(job))
  }

  async preview(input: ApplyInput) {
    const preferred = requirePreferred(input.preferredDomain)
    const targets = await this.resolveTargets(input)
    const items = targets.map((item) => ({
      hostname: item.hostname,
      current_preferred: currentPreferred(item),
      auto_preferred: Boolean(item.auto_preferred),
      will_change: currentPreferred(item) !== preferred,
    }))
    return {
      preferred_domain: preferred,
      only_auto_preferred: Boolean(input.onlyAutoPreferred),
      total: targets.length,
      // 前端展示的“将变更”数量：只有真正需要切换的主机名才计入
      will_change: items.filter((item) => item.will_change).length,
      items,
    }
  }

  /** 创建切换任务；dryRun 直接生成已完成的预览任务 */
  async create(input: ApplyInput): Promise<PreferredApplyJob> {
    const preferred = requirePreferred(input.preferredDomain)
    const targets = await this.resolveTargets(input)
    if (!targets.length)
      throw new ApiError('preferred_apply_empty', 'No hostnames matched for preferred-domain apply', 422)

    const payload = {
      provider_id: input.providerId,
      zone_name: input.zoneName,
      resource_keys: await this.workflow.resourceKeys(input.providerId, input.zoneName),
      preferred_domain: preferred,
      only_auto_preferred: Boolean(input.onlyAutoPreferred),
      dry_run: Boolean(input.dryRun),
    }
    const items = targets.map((item) => ({
      hostname: item.hostname,
      preferred_domain: preferred,
      current_preferred: currentPreferred(item),
      auto_preferred: Boolean(item.auto_preferred),
    }))
    const lock = this.kind.lock(payload)

    if (!input.dryRun) {
      return this.kind.present(
        await this.jobs.createExclusive(PREFERRED_APPLY_JOB, payload, items, lock, {
          message: '任务已创建，等待后台执行',
        })
      )
    }

    const previewItems = items.map((item) => {
      const willChange = item.current_preferred !== preferred
      return {
        ...item,
        status: willChange ? 'success' : 'skipped',
        message: willChange ? `将切换为 ${preferred}` : '已是目标优选域名',
      }
    })
    const success = previewItems.filter((item) => item.status === 'success').length
    const skipped = previewItems.length - success
    const job = await this.jobs.createTerminalExclusive(PREFERRED_APPLY_JOB, payload, previewItems, lock, {
      status: 'completed',
      success,
      skipped,
      failed: 0,
      message: `预览完成：将切换 ${success} 个，跳过 ${skipped} 个`,
    })
    return this.kind.present(job)
  }

  find(id: string, providerId?: string) {
    return this.kind.find(id, { provider_id: providerId })
  }

  active(providerId: string, zoneName: string) {
    return this.kind.active({ provider_id: providerId, zone_name: zoneName })
  }

  retryFailed(id: string, providerId?: string) {
    return this.kind.retryFailed(id, { provider_id: providerId })
  }

  private async runJob(job: JobRecord): Promise<void> {
    if (job.payload.dry_run) return
    const providerId = String(job.payload.provider_id ?? '')
    const zoneName = String(job.payload.zone_name ?? '')
    const preferred = String(job.payload.preferred_domain ?? '')

    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.hostname ?? ''),
      runningMessage: '处理中',
      progressMessage: '后台执行中',
      execute: async (_item, hostname) => {
        const updated = await this.workflow.updateHostname(
          providerId,
          zoneName,
          hostname,
          { preferred_domain: preferred, auto_preferred: true },
          true
        )
        const sync = dnsEffectOf(updated, 'sync')
        if (sync?.status === 'failed') {
          return {
            status: 'failed',
            message: `优选已保存，但 DNS 写回失败：${sync.message || '未知错误'}`,
            extra: { preferred_domain: preferred, dns_sync_status: 'failed' },
          }
        }
        return {
          status: 'success',
          message: `已切换为 ${preferred}${dnsEffectNote(sync, 'DNS 已写回')}`,
          extra: { preferred_domain: preferred, dns_sync_status: sync?.status ?? 'unknown' },
        }
      },
    })
    await finishBatchJob(this.jobs, job.id, '优选应用')
  }

  private async resolveTargets(input: ApplyInput): Promise<CloudflareCustomHostname[]> {
    let items = (await this.hostnames.hostnames(input.providerId, input.zoneName)).items
    if (input.hostnames?.length) {
      const selected = new Set(input.hostnames.map((hostname) => hostname.toLowerCase().trim()))
      items = items.filter((item) => selected.has(item.hostname.toLowerCase()))
    }
    return input.onlyAutoPreferred ? items.filter((item) => item.auto_preferred) : items
  }
}

function requirePreferred(value: string): string {
  const preferred = String(value ?? '').trim()
  if (!preferred) throw new ApiError('preferred_domain_invalid', 'Preferred domain is required', 422)
  return preferred
}
