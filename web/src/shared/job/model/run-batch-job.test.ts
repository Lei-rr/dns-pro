import { afterEach, describe, expect, it } from 'vitest'
import { confirmState, settleConfirm } from '@/shared/ui/confirm/confirm'
import { useJobProgress } from './use-job-progress'
import { runBatchJob } from './run-batch-job'

/**
 * 失败任务的确认弹窗属于打开它的 scope：scope 失效（reset / 路由切换）后，
 * 那次确认不得触发 retry、不得清空新 scope 的选择、不得重载数据。
 * 迁移自 scripts/isolated-job-progress-probe.ts（探针已退役）。
 */

async function waitFor(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

afterEach(() => {
  // confirm 是模块级单例：用例结束前把未决弹窗收尾，避免跨用例串状态
  if (confirmState.open.value) settleConfirm(false)
})

describe('runBatchJob', () => {
  it('失败任务的确认属于打开它的 scope：reset 后确认不得 retry / 清空选择 / 重载', async () => {
    const jobProgress = useJobProgress()
    let retryCalls = 0
    let clearCalls = 0
    let doneCalls = 0

    const batch = runBatchJob({
      label: '旧 scope 批量',
      create: async () => ({ data: { id: 'stale-job' } }),
      fetchJob: async () => ({
        id: 'stale-job',
        status: 'failed',
        message: '旧任务失败',
        items: [{ id: 'failed-item', status: 'failed', message: '失败' }],
      }),
      retry: async () => {
        retryCalls++
      },
      clearSelection: () => {
        clearCalls++
      },
      onDone: async () => {
        doneCalls++
      },
      jobProgress,
    })

    await waitFor(() => confirmState.open.value, 'failed-job confirmation did not open')

    jobProgress.reset()
    settleConfirm(true)

    expect(await batch).toBeNull()
    // 迟到的确认不得触发重试 / 清空新 scope 的选择 / 重载
    expect(retryCalls).toBe(0)
    expect(clearCalls).toBe(0)
    expect(doneCalls).toBe(0)
  })
})
