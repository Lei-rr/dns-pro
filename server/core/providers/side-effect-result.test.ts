import { describe, expect, it } from 'vitest'
import { fromDnsOperationResult } from './side-effect-result.js'

/**
 * DNS 单步结果 → 副作用摘要必须递归检查嵌套条目：
 * 顶层 action 是 completed 也要看出 records[].status === 'failed'，
 * 否则失败会被折叠成成功，前端展示与实际状态相反。
 */

describe('fromDnsOperationResult：嵌套失败项必须上浮为 failed', () => {
  it('action=completed 但 records 中有 failed 条目时 status=failed', () => {
    const effect = fromDnsOperationResult({ action: 'completed', records: [{ status: 'failed' }] }, 'done')
    expect(effect.status).toBe('failed')
  })
})
