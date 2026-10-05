import { ApiError } from '../../core/http/api-error.js'
import type { JobService } from '../../core/jobs/job.service.js'
import type { JobRecord } from '../../core/jobs/job.types.js'
import {
  BatchJobKind,
  dedupeStrings,
  dnsEffectNote,
  dnsEffectOf,
  finishBatchJob,
  persistItemStage,
  runBatchItems,
  type BatchJobViewBase,
} from '../../core/jobs/batch-job.js'
import type { EdgeOneDomainService } from '../../modules/edgeone/edge-one-domain.service.js'
import {
  EDGEONE_BATCH_DELETE_JOB,
  EDGEONE_BATCH_DISABLE_JOB,
  EDGEONE_ZONE_JOB_TYPES,
  ZONE_WRITE_JOB_TYPES,
  readResourceKeys,
} from '../../core/jobs/job-registry.js'
import { completedEdgeOneDeleteStages, type EdgeOneDnsSyncWorkflow } from './edge-one-dns-sync.workflow.js'

type EdgeOneBatchJobView = BatchJobViewBase & { provider_id: string; zone_id: string }
type ZoneScope = { providerId: string; zoneId: string }

const byDomain = (domain: string) => (row: Record<string, unknown>) => String(row.domain ?? '') === domain

/** EdgeOne 加速域名批量 停用/删除；与 DNS 批量等任务按底层写入资源键（EdgeOne 站点 + 关联 DNSPod 域名）互斥 */
export class EdgeOneBatchWorkflow {
  private readonly kind: BatchJobKind<EdgeOneBatchJobView>

  constructor(
    private readonly jobs: JobService,
    private readonly domains: EdgeOneDomainService,
    private readonly dnsSync: EdgeOneDnsSyncWorkflow
  ) {
    this.kind = new BatchJobKind(jobs, {
      types: EDGEONE_ZONE_JOB_TYPES,
      lockTypes: ZONE_WRITE_JOB_TYPES,
      scopeKeys: ['provider_id', 'zone_id'],
      resourceKeys: readResourceKeys,
      present: (job, base) => ({
        ...base,
        provider_id: String(job.payload.provider_id ?? ''),
        zone_id: String(job.payload.zone_id ?? ''),
      }),
    })
    jobs.registerRunner(EDGEONE_BATCH_DISABLE_JOB, (job) => this.runDisable(job))
    jobs.registerRunner(EDGEONE_BATCH_DELETE_JOB, (job) => this.runDelete(job))
  }

  createDisable(input: ZoneScope & { domains: string[] }) {
    const items = this.items(input.domains, () => ({}))
    return this.enqueue(EDGEONE_BATCH_DISABLE_JOB, input, { status: 'offline' }, items, '批量停用任务已创建')
  }

  createDelete(input: ZoneScope & { domains: string[]; autoCleanup?: boolean }) {
    const autoCleanup = input.autoCleanup !== false
    const items = this.items(input.domains, () => ({
      primary_deleted: false,
      dns_cleanup_status: autoCleanup ? 'pending' : 'not_required',
    }))
    return this.enqueue(EDGEONE_BATCH_DELETE_JOB, input, { auto_cleanup: autoCleanup }, items, '批量删除任务已创建')
  }

  find(id: string, providerId?: string) {
    return this.kind.find(id, { provider_id: providerId })
  }

  async active(providerId: string, zoneId: string) {
    // 面板反查只认本族任务（与详情端点同口径）；跨工作流冲突由创建路径按资源键 409 拦截
    return this.kind.active({ provider_id: providerId, zone_id: zoneId })
  }

  retryFailed(id: string, providerId?: string) {
    return this.kind.retryFailed(id, { provider_id: providerId })
  }

  private items(domains: string[], extra: () => Record<string, unknown>) {
    const unique = dedupeStrings(domains ?? [])
    if (!unique.length) throw new ApiError('batch_empty', 'No domains selected', 422)
    return unique.map((domain) => ({ domain, ...extra() }))
  }

  private async enqueue(
    type: string,
    scope: ZoneScope,
    extra: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    message: string
  ) {
    const itemDomains = items.map((item) => String(item.domain ?? '')).filter(Boolean)
    const payload = {
      provider_id: scope.providerId,
      zone_id: scope.zoneId,
      resource_keys: await this.dnsSync.resourceKeys(scope.providerId, scope.zoneId, itemDomains),
      ...extra,
    }
    return this.kind.present(
      await this.jobs.createExclusive(type, payload, items, this.kind.lock(payload), { message })
    )
  }

  private async runDisable(job: JobRecord): Promise<void> {
    const { providerId, zoneId } = scopeOf(job)
    const status = String(job.payload.status ?? 'offline')
    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.domain ?? ''),
      runningMessage: '停用中',
      progressMessage: '批量停用执行中',
      execute: async (_item, domain) => {
        await this.domains.updateAccelerationDomainStatus(providerId, zoneId, domain, status)
        return { status: 'success', message: '已停用' }
      },
    })
    await finishBatchJob(this.jobs, job.id, '批量停用')
  }

  /** 分阶段删除：主资源删除成功先落盘，重试时只补做 DNS 清理 */
  private async runDelete(job: JobRecord): Promise<void> {
    const { providerId, zoneId } = scopeOf(job)
    const autoCleanup = job.payload.auto_cleanup !== false
    // CNAME 快照只取一次，避免每条目都全量拉取加速域名列表
    const cnames = autoCleanup ? await this.cnameSnapshot(providerId, zoneId) : new Map<string, string>()
    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.domain ?? ''),
      runningMessage: '删除中',
      progressMessage: '批量删除执行中',
      execute: async (item, domain) => {
        const completed = completedEdgeOneDeleteStages(item)
        const result = await this.dnsSync.deleteAccelerationDomain(providerId, zoneId, domain, autoCleanup, {
          completed,
          // 仅在首次删除时使用快照 CNAME；重试时域名已删除，快照可能过期，回退到按名称+类型清理
          cname: autoCleanup && !completed.includes('primary-deleted') ? (cnames.get(domain) ?? '') : undefined,
          onStage: (_stage, patch) => persistItemStage(this.jobs, job.id, byDomain(domain), patch),
        })
        const cleanup = dnsEffectOf(result, 'cleanup')
        if (autoCleanup && cleanup?.status === 'failed') {
          return {
            status: 'failed',
            message: `加速域名已删除，但 DNS 清理失败：${cleanup.message || '未知错误'}`,
            extra: { primary_deleted: true, dns_cleanup_status: 'failed' },
          }
        }
        return {
          status: 'success',
          message: `已删除${autoCleanup ? dnsEffectNote(cleanup, 'DNS 已清理') : ''}`,
          extra: {
            primary_deleted: true,
            dns_cleanup_status: autoCleanup ? (cleanup?.status ?? 'skipped') : 'not_required',
          },
        }
      },
    })
    await finishBatchJob(this.jobs, job.id, '批量删除')
  }

  /** 任务开始时一次性读取 域名 → CNAME */
  private async cnameSnapshot(providerId: string, zoneId: string): Promise<Map<string, string>> {
    const listing = await this.domains.accelerationDomains(providerId, zoneId, true)
    return new Map(listing.items.map((item) => [item.name, item.cname ?? '']))
  }
}

function scopeOf(job: JobRecord): ZoneScope {
  return { providerId: String(job.payload.provider_id ?? ''), zoneId: String(job.payload.zone_id ?? '') }
}
