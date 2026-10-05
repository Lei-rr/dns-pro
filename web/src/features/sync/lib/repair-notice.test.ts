import { describe, expect, it } from 'vitest'
import { buildRepairNotice, type RepairOutcome } from './repair-notice'

/** status → 执行期 action 的合法映射（与后端 dns-writer 的闭合联合一致） */
const ACTION_BY_STATUS: Record<RepairOutcome['status'], RepairOutcome['action']> = {
  created: 'create',
  updated: 'update',
  deleted: 'delete',
  unchanged: 'unchanged',
  skipped: 'create',
  not_found: 'delete',
  failed: 'create',
}

/** 构造一条写入结果：只关心 status 与 error，其余字段与后端 dns-writer 的形态对齐 */
function outcome(status: RepairOutcome['status'], error?: string): RepairOutcome {
  return {
    purpose: 'SaaS 主机名',
    action: ACTION_BY_STATUS[status],
    status,
    fqdn: 'api.example.com',
    value: 'target.example.com',
    record_id: '',
    ...(error ? { error } : {}),
  }
}

describe('buildRepairNotice 修复结果提示', () => {
  it('全部失败时上报失败条数与首条原因，不得退化成「均无需变更」', () => {
    const notice = buildRepairNotice([outcome('failed', '上游写入超时'), outcome('failed', '记录归属冲突')])

    expect(notice.tone).toBe('error')
    expect(notice.message).toContain('2 条失败')
    expect(notice.message).toContain('上游写入超时')
    expect(notice.message).not.toContain('均无需变更')
  })

  it('部分成功 + 部分失败：失败优先上报，同时保留已修复与跳过计数', () => {
    const notice = buildRepairNotice([
      outcome('created'),
      outcome('updated'),
      outcome('skipped'),
      outcome('failed', 'DNS 写入失败'),
    ])

    expect(notice.tone).toBe('error')
    expect(notice.message).toContain('已修复 2 条')
    expect(notice.message).toContain('跳过 1 条（归属冲突）')
    expect(notice.message).toContain('1 条失败')
  })

  it('没有失败项时保持原语义：无变更提示「均无需变更」，有变更给出计数', () => {
    expect(buildRepairNotice([outcome('unchanged')])).toEqual({ tone: 'success', message: '派生记录均无需变更' })
    expect(buildRepairNotice([outcome('created')])).toEqual({ tone: 'success', message: '已修复 1 条' })
    expect(buildRepairNotice([outcome('updated'), outcome('skipped')]).message).toBe(
      '已修复 1 条，跳过 1 条（归属冲突）'
    )
  })
})
