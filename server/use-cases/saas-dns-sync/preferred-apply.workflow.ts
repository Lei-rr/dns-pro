import { ApiError } from '../../core/http/api-error.js'
import type { JobService } from '../../core/jobs/job.service.js'
import type { JobRecord } from '../../core/jobs/job.types.js'
import { BatchJobKind, finishBatchJob, runBatchItems, type BatchJobViewBase } from '../../core/jobs/batch-job.js'
import type { CloudflareCustomHostname } from '../../modules/cloudflare/saas/saas-custom-hostname.client.js'
import type { SaaSHostnameService } from '../../modules/cloudflare/saas/saas-hostname.service.js'
import {
  PREFERRED_APPLY_JOB,
  SAAS_ZONE_LOCK_MESSAGE,
  ZONE_WRITE_JOB_TYPES,
  readResourceKeys,
} from '../../core/jobs/job-types.js'
import { effectivePreferredDomain } from '../../modules/cloudflare/saas/saas-hostname-rules.js'
import { itemResultFromSideEffects } from './saas-batch-item-result.js'
import { invalidateSaasZoneListCache } from './saas-zone-cache.js'
import type { SaaSDnsSyncWorkflow } from './saas-dns-sync.workflow.js'

type PreferredApplyJob = BatchJobViewBase & {
  provider_id: string
  zone_name: string
  preferred_domain: string
  only_auto_preferred: boolean
}

type ApplyInput = {
  providerId: string
  zoneName: string
  preferredDomain: string
  hostnames?: string[]
  onlyAutoPreferred?: boolean
}

const currentPreferred = (item: CloudflareCustomHostname) => effectivePreferredDomain(item)

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
      }),
    })
    jobs.registerRunner(PREFERRED_APPLY_JOB, (job) => this.runJob(job))
  }

  async preview(input: ApplyInput) {
    const preferred = await this.requireAllowedPreferred(input.preferredDomain)
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

  /** 创建切换任务：目标主机名已在前置校验中确定，入队后由后台执行 */
  async create(input: ApplyInput): Promise<PreferredApplyJob> {
    const preferred = await this.requireAllowedPreferred(input.preferredDomain)
    const targets = await this.resolveTargets(input)
    if (!targets.length)
      throw new ApiError('preferred_apply_empty', 'No hostnames matched for preferred-domain apply', 422)

    const payload = {
      provider_id: input.providerId,
      zone_name: input.zoneName,
      resource_keys: await this.workflow.resourceKeys(
        input.providerId,
        input.zoneName,
        targets.map((item) => String(item.hostname ?? '')).filter(Boolean)
      ),
      preferred_domain: preferred,
      only_auto_preferred: Boolean(input.onlyAutoPreferred),
    }
    const items = targets.map((item) => ({
      hostname: item.hostname,
      preferred_domain: preferred,
      current_preferred: currentPreferred(item),
      auto_preferred: Boolean(item.auto_preferred),
    }))
    return this.kind.present(
      await this.jobs.createExclusive(PREFERRED_APPLY_JOB, payload, items, this.kind.lock(payload), {
        message: '任务已创建，等待后台执行',
      })
    )
  }

  /** 归属校验按 SaaS 服务商：providerId 必填，缺失即不匹配（查不到走本族 not_found） */
  require(id: string, providerId: string) {
    return this.kind.require(id, { provider_id: providerId })
  }

  async active(providerId: string, zoneName: string) {
    // 同 SaaS 批量：面板反查只认本族任务（与详情端点同口径），跨工作流冲突由创建路径判定
    return this.kind.active({ provider_id: providerId, zone_name: zoneName })
  }

  retryFailed(id: string, providerId: string) {
    return this.kind.retryFailed(id, { provider_id: providerId })
  }

  private async runJob(job: JobRecord): Promise<void> {
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
          true,
          // 批量逐条更新：抑制逐条列表缓存失效，否则每条都要重新分页拉取整站主机名（O(N²) 上游请求）
          { deferListInvalidation: true }
        )
        return itemResultFromSideEffects(updated, {
          successMessage: `已切换为 ${preferred}`,
          extra: { preferred_domain: preferred },
          localFailureMessage: '优选已保存，但本地偏好保存失败',
          syncFailureMessage: '优选已保存，但 DNS 写回失败',
        })
      },
    })
    await finishBatchJob(this.jobs, job.id, '优选应用')
    await invalidateSaasZoneListCache(this.hostnames, providerId, zoneName)
  }

  private async resolveTargets(input: ApplyInput): Promise<CloudflareCustomHostname[]> {
    let items = (await this.hostnames.hostnames(input.providerId, input.zoneName)).items
    if (input.hostnames?.length) {
      const selected = new Set(input.hostnames.map((hostname) => hostname.toLowerCase().trim()))
      items = items.filter((item) => selected.has(item.hostname.toLowerCase()))
    }
    return input.onlyAutoPreferred ? items.filter((item) => item.auto_preferred) : items
  }

  /** 预览/创建前置校验：白名单判定复用主机名写入路径，非法域名在任务创建阶段即失败 */
  private async requireAllowedPreferred(value: string): Promise<string> {
    return await this.hostnames.ensurePreferredDomainAllowed(requirePreferred(value))
  }
}

function requirePreferred(value: string): string {
  const preferred = String(value ?? '').trim()
  if (!preferred) throw new ApiError('preferred_domain_invalid', 'Preferred domain is required', 422)
  return preferred
}
