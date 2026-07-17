import * as crypto from 'node:crypto'
import { ApiError } from '../../../lib/http/api-error.js'
import { JsonStore } from '../../../lib/storage/json-store.js'
import type { CloudflareCustomHostname } from '../gateways/custom-hostname-gateway.js'
import { SaasWorkflowService } from './workflow-service.js'
import { SaasHostnameService } from './hostname-service.js'

export type PreferredApplyJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type PreferredApplyItemResult = {
  hostname: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  message?: string
  preferred_domain?: string
}

export type PreferredApplyJob = {
  id: string
  provider_id: string
  zone_name: string
  preferred_domain: string
  /** only hosts with auto_preferred=true */
  only_auto_preferred: boolean
  dry_run: boolean
  status: PreferredApplyJobStatus
  total: number
  done: number
  success: number
  failed: number
  skipped: number
  current?: string
  items: PreferredApplyItemResult[]
  created_at: number
  updated_at: number
  finished_at?: number
  message?: string
}

type StoreShape = { items: PreferredApplyJob[] }

const ACTIVE = new Set<PreferredApplyJobStatus>(['pending', 'running'])

export class SaasPreferredApplyService {
  private readonly running = new Map<string, Promise<void>>()

  constructor(
    private readonly store = new JsonStore<StoreShape>('saas/preferred-apply-jobs.json', { items: [] }),
    private readonly workflow = new SaasWorkflowService(),
    private readonly hostnames = new SaasHostnameService(),
  ) {}

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
      items: list.map((item) => ({
        hostname: item.hostname,
        current_preferred: String((item as any).preferred_domain ?? item.custom_metadata?.preferred_domain ?? ''),
        auto_preferred: !!(item as any).auto_preferred,
        will_change: String((item as any).preferred_domain ?? item.custom_metadata?.preferred_domain ?? '') !== preferred,
      })),
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

    const now = Date.now()
    const job: PreferredApplyJob = {
      id: crypto.randomBytes(8).toString('hex'),
      provider_id: input.providerId,
      zone_name: input.zoneName,
      preferred_domain: preferred,
      only_auto_preferred: !!input.onlyAutoPreferred,
      dry_run: !!input.dryRun,
      status: 'pending',
      total: targets.length,
      done: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      items: targets.map((t) => ({
        hostname: t.hostname,
        status: 'pending',
        preferred_domain: preferred,
      })),
      created_at: now,
      updated_at: now,
      message: input.dryRun ? '预览任务已创建' : '任务已创建，等待后台执行',
    }

    await this.store.transaction((current) => ({
      next: { items: [...(current.items ?? []).filter((j) => !ACTIVE.has(j.status) || j.id === job.id), job] },
      result: job,
    }))

    if (!job.dry_run) this.ensureBackground(job.id)
    else {
      // dry-run completes immediately with will_change markers
      await this.completeDryRun(job.id, targets, preferred)
    }

    return (await this.find(job.id)) ?? job
  }

  async find(id: string): Promise<PreferredApplyJob | null> {
    const job = (await this.all()).find((j) => j.id === id) ?? null
    if (job && (job.status === 'pending' || job.status === 'running')) this.ensureBackground(job.id)
    return job
  }

  async active(providerId: string, zoneName: string): Promise<PreferredApplyJob | null> {
    return this.findActive(providerId, zoneName)
  }

  async retryFailed(jobId: string): Promise<PreferredApplyJob> {
    const job = await this.require(jobId)
    if (job.status === 'running' || job.status === 'pending') {
      throw new ApiError('preferred_apply_running', 'Job is still running', 409, { job_id: jobId })
    }
    const failed = job.items.filter((i) => i.status === 'failed')
    if (!failed.length) throw new ApiError('preferred_apply_no_failed', 'No failed items to retry', 422)

    const now = Date.now()
    const next: PreferredApplyJob = {
      ...job,
      status: 'pending',
      done: job.items.filter((i) => i.status === 'success' || i.status === 'skipped').length,
      failed: 0,
      message: '失败项重试中',
      finished_at: undefined,
      updated_at: now,
      items: job.items.map((item) =>
        item.status === 'failed' ? { ...item, status: 'pending', message: undefined } : item,
      ),
    }
    await this.save(next)
    this.ensureBackground(next.id)
    return (await this.find(next.id)) ?? next
  }

  private async completeDryRun(
    jobId: string,
    targets: CloudflareCustomHostname[],
    preferred: string,
  ): Promise<void> {
    const job = await this.require(jobId)
    const items: PreferredApplyItemResult[] = targets.map((t) => {
      const current = String((t as any).preferred_domain ?? t.custom_metadata?.preferred_domain ?? '')
      const willChange = current !== preferred
      return {
        hostname: t.hostname,
        status: willChange ? 'success' : 'skipped',
        preferred_domain: preferred,
        message: willChange ? `将切换为 ${preferred}` : '已是目标优选域名',
      }
    })
    const success = items.filter((i) => i.status === 'success').length
    const skipped = items.filter((i) => i.status === 'skipped').length
    await this.save({
      ...job,
      status: 'completed',
      items,
      done: items.length,
      success,
      skipped,
      failed: 0,
      finished_at: Date.now(),
      updated_at: Date.now(),
      message: `预览完成：将切换 ${success} 个，跳过 ${skipped} 个`,
    })
  }

  private ensureBackground(jobId: string) {
    if (this.running.has(jobId)) return
    const promise = this.run(jobId)
      .catch(() => undefined)
      .finally(() => this.running.delete(jobId))
    this.running.set(jobId, promise)
  }

  private async run(jobId: string): Promise<void> {
    const job = await this.require(jobId)
    if (job.dry_run) return
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return

    await this.patch(jobId, { status: 'running', message: '后台执行中', updated_at: Date.now() })

    for (let i = 0; i < job.items.length; i++) {
      const current = await this.require(jobId)
      if (current.status === 'cancelled') return
      const item = current.items[i]!
      if (item.status === 'success' || item.status === 'skipped') continue

      await this.patchItem(jobId, item.hostname, {
        status: 'running',
        message: '处理中',
      }, { current: item.hostname })

      try {
        await this.workflow.updateHostname(
          current.provider_id,
          current.zone_name,
          item.hostname,
          {
            preferred_domain: current.preferred_domain,
            auto_preferred: true,
          },
          true,
        )
        await this.patchItem(jobId, item.hostname, {
          status: 'success',
          message: `已切换为 ${current.preferred_domain}`,
          preferred_domain: current.preferred_domain,
        })
      } catch (error) {
        await this.patchItem(jobId, item.hostname, {
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const finalJob = await this.require(jobId)
    const success = finalJob.items.filter((i) => i.status === 'success').length
    const failed = finalJob.items.filter((i) => i.status === 'failed').length
    const skipped = finalJob.items.filter((i) => i.status === 'skipped').length
    await this.save({
      ...finalJob,
      status: failed > 0 && success === 0 ? 'failed' : 'completed',
      success,
      failed,
      skipped,
      done: finalJob.items.length,
      current: undefined,
      finished_at: Date.now(),
      updated_at: Date.now(),
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
    // Pull a reasonably large page; SaaS zones for personal use are usually small.
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

  private async findActive(providerId: string, zoneName: string): Promise<PreferredApplyJob | null> {
    return (
      (await this.all()).find(
        (j) => j.provider_id === providerId && j.zone_name === zoneName && ACTIVE.has(j.status),
      ) ?? null
    )
  }

  private async all(): Promise<PreferredApplyJob[]> {
    const data = await this.store.read()
    return data.items ?? []
  }

  private async require(id: string): Promise<PreferredApplyJob> {
    const job = await this.find(id)
    if (!job) throw new ApiError('preferred_apply_not_found', 'Preferred apply job not found', 404, { job_id: id })
    return job
  }

  private async save(job: PreferredApplyJob): Promise<void> {
    await this.store.transaction((current) => ({
      next: {
        items: (current.items ?? []).map((item) => (item.id === job.id ? job : item)),
      },
    }))
  }

  private async patch(jobId: string, patch: Partial<PreferredApplyJob>): Promise<void> {
    await this.store.transaction((current) => ({
      next: {
        items: (current.items ?? []).map((item) =>
          item.id === jobId ? { ...item, ...patch, updated_at: Date.now() } : item,
        ),
      },
    }))
  }

  private async patchItem(
    jobId: string,
    hostname: string,
    itemPatch: Partial<PreferredApplyItemResult>,
    jobPatch: Partial<PreferredApplyJob> = {},
  ): Promise<void> {
    await this.store.transaction((current) => ({
      next: {
        items: (current.items ?? []).map((job) => {
          if (job.id !== jobId) return job
          const items = job.items.map((item) => (item.hostname === hostname ? { ...item, ...itemPatch } : item))
          const done = items.filter((i) => i.status === 'success' || i.status === 'failed' || i.status === 'skipped').length
          const success = items.filter((i) => i.status === 'success').length
          const failed = items.filter((i) => i.status === 'failed').length
          const skipped = items.filter((i) => i.status === 'skipped').length
          return {
            ...job,
            ...jobPatch,
            items,
            done,
            success,
            failed,
            skipped,
            updated_at: Date.now(),
          }
        }),
      },
    }))
  }
}
