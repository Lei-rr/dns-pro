/**
 * §4.2 统一 reconcile 引擎：三条产品线（SaaS / 隧道 / EdgeOne）共用。
 *
 * 扫描派生关系 → 对比现状（planSync）→ 产出修复计划 → 可选执行。
 * 检测（只读）与执行（经 DnsWriter，所有权校验内建）严格分离：
 *   - detect() 只按 DnsRecordPort.find 取证，不产生任何远端写操作；
 *   - apply() 只把 create/update 条目交给 DnsWriter.apply，删除与人工记录永不自动处理。
 * 手动触发，无定时器（符合单用户与惰性哲学）。
 */
import type { DnsRecordPort, DnsRecordRef } from '../../core/contracts/dns-record.port.js'
import { errorMessage } from '../../shared/values.js'
import type { DnsWriter, WriteOutcome } from './dns-writer.js'
import type {
  DerivedSourcePlanner,
  DerivedStatus,
  PlannedRecord,
  ReconcileItem,
  ReconcileReport,
  ReconcileScope,
  ReconcileSummary,
} from './derived-record.types.js'
import { planSync, recordProbe, type SyncAction, type SyncPlan, type SyncPlanEntry } from './sync-plan.js'

/** 引擎结果：检测报告 + 执行痕迹（只读检测时 executed_at 为 null、results 为空） */
export interface ReconcileResult extends ReconcileReport {
  executed_at: string | null
  results: WriteOutcome[]
}

type TargetGroup = {
  providerType: string
  providerId: string
  zone: string
  planned: PlannedRecord[]
}

type ItemGroup = {
  providerType: string
  providerId: string
  zone: string
  items: ReconcileItem[]
}

const STATUS_BY_ACTION: Record<SyncAction, DerivedStatus> = {
  unchanged: 'synced',
  create: 'missing',
  update: 'drifted',
  delete: 'drifted',
}

export class ReconcileService {
  constructor(
    private readonly planners: readonly DerivedSourcePlanner[],
    private readonly ports: Record<string, DnsRecordPort>,
    private readonly writer: DnsWriter
  ) {}

  /** F1/F2 检测：只读扫描全部（或指定范围内）派生关系，返回漂移状态 */
  async detect(scope: ReconcileScope = {}): Promise<ReconcileReport> {
    const planned: PlannedRecord[] = []
    for (const planner of this.planners) {
      if (scope.kind && planner.kind !== scope.kind) continue
      planned.push(...(await planner.scan(scope)))
    }
    const items: ReconcileItem[] = []
    for (const group of groupByTarget(planned)) items.push(...(await this.detectGroup(group)))
    return { scanned_at: new Date().toISOString(), scope, items, summary: summarize(items) }
  }

  /** F2 执行：检测出的漂移/缺失经 DnsWriter 修复（所有权门禁内建），单条失败不中断其余 */
  async apply(report: ReconcileReport): Promise<ReconcileResult> {
    const results: WriteOutcome[] = []
    const settled = new Map<string, WriteOutcome>()
    for (const group of groupItems(report.items)) {
      const actionable = group.items.filter((item) => item.action === 'create' || item.action === 'update')
      if (actionable.length === 0) continue
      const plan: SyncPlan = {
        providerType: group.providerType,
        providerId: group.providerId,
        zone: group.zone,
        entries: actionable.map(toPlanEntry),
      }
      const outcomes = await this.writer.apply(group.providerType, group.providerId, group.zone, plan)
      actionable.forEach((item, index) => settled.set(itemKey(item), outcomes[index] ?? failedOutcome(item)))
      results.push(...outcomes)
    }

    const items = report.items.map((item) => {
      const outcome = settled.get(itemKey(item))
      if (!outcome) return item
      return {
        ...item,
        status: outcome.status === 'failed' || outcome.status === 'skipped' ? 'failed' : 'synced',
        error: outcome.error,
      }
    }) as ReconcileItem[]
    return { ...report, items, summary: summarize(items), executed_at: new Date().toISOString(), results }
  }

  /** F1 一键修复 / F2 手动对账：先只读检测，再执行漂移项 */
  async reconcile(scope: ReconcileScope = {}): Promise<ReconcileResult> {
    return this.apply(await this.detect(scope))
  }

  private async detectGroup(group: TargetGroup): Promise<ReconcileItem[]> {
    const port = this.ports[group.providerType]
    if (!port) {
      const reason = `dns_provider_unsupported: ${group.providerType}`
      return group.planned.map((item) => failedItem(item, reason))
    }
    const desired = group.planned.map((item) => item.desired)
    const current: DnsRecordRef[] = []
    try {
      for (const want of desired) {
        current.push(
          ...(await port.find(group.providerId, group.zone, recordProbe(want.fqdn, group.zone, want.record.type)))
        )
      }
    } catch (error) {
      // 上游查询失败只影响本组：如实标记 failed，不影响其它派生关系的检测
      const reason = errorMessage(error)
      return group.planned.map((item) => failedItem(item, reason))
    }
    const plan = planSync({
      providerType: group.providerType,
      providerId: group.providerId,
      zone: group.zone,
      desired,
      current,
    })
    return group.planned.map((item, index) => {
      const entry = plan.entries[index]
      if (!entry) return failedItem(item, '计划条目缺失')
      return {
        ...item,
        status: STATUS_BY_ACTION[entry.action],
        lastSyncedAt: null,
        action: entry.action,
        current: entry.existing ?? null,
      }
    })
  }
}

function toPlanEntry(item: ReconcileItem): SyncPlanEntry {
  return {
    purpose: item.purpose,
    action: item.action,
    fqdn: item.target.fqdn,
    record: item.desired.record,
    owner: item.owner,
    refId: String(item.desired.refId ?? ''),
    ...(item.current ? { existing: item.current } : {}),
  }
}

function failedOutcome(item: ReconcileItem): WriteOutcome {
  return {
    purpose: item.purpose,
    action: item.action,
    status: 'failed',
    fqdn: item.target.fqdn,
    value: String(item.desired.record.value ?? ''),
    record_id: String(item.current?.id ?? ''),
    error: '写入口未返回结果',
  }
}

function failedItem(item: PlannedRecord, error: string): ReconcileItem {
  return { ...item, status: 'failed', lastSyncedAt: null, action: 'unchanged', current: null, error }
}

function itemKey(item: ReconcileItem): string {
  return [item.target.providerType, item.target.providerId, item.target.zone, item.target.fqdn, item.purpose].join('|')
}

function groupByTarget(planned: readonly PlannedRecord[]): TargetGroup[] {
  const groups = new Map<string, TargetGroup>()
  for (const item of planned) {
    const key = [item.target.providerType, item.target.providerId, item.target.zone].join('|')
    const group = groups.get(key) ?? {
      providerType: item.target.providerType,
      providerId: item.target.providerId,
      zone: item.target.zone,
      planned: [],
    }
    group.planned.push(item)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function groupItems(items: readonly ReconcileItem[]): ItemGroup[] {
  const groups = new Map<string, ItemGroup>()
  for (const item of items) {
    const key = [item.target.providerType, item.target.providerId, item.target.zone].join('|')
    const group = groups.get(key) ?? {
      providerType: item.target.providerType,
      providerId: item.target.providerId,
      zone: item.target.zone,
      items: [],
    }
    group.items.push(item)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function summarize(items: readonly ReconcileItem[]): ReconcileSummary {
  const summary: ReconcileSummary = { total: items.length, synced: 0, drifted: 0, missing: 0, failed: 0 }
  for (const item of items) summary[item.status] += 1
  return summary
}
