import { describe, expect, it } from 'vitest'
import type { JobLike } from './types'
import { useJobProgress } from './use-job-progress'

/**
 * useJobProgress：批量任务进度的唯一载体。
 * 迁移自 scripts/isolated-job-progress-probe.ts（探针已退役）与 scripts/isolated-frontend-audit-probe.ts。
 * 恢复探测 / 轮询 / 重置都是顺序敏感的多步骤流程，分别保持在一个 it 内。
 */

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useJobProgress', () => {
  it('恢复活跃任务失败必须与「无活跃任务」可区分', async () => {
    const progress = useJobProgress()
    const resumeResult = await progress.resumeActive(
      async () => {
        throw new Error('active job unavailable')
      },
      { fetchJob: async () => ({ id: 'unused', status: 'completed' }), autoClearMs: 0 }
    )

    expect(resumeResult).toBeNull()
    expect(progress.running.value).toBe(false)
    // 失败必须留下可读的错误信息，不能像「没有活跃任务」那样安静
    expect(progress.resumeError.value).toBe('active job unavailable')
  })

  it('探测期间不得显示进度；探测结果为空不得残留 running', async () => {
    const progress = useJobProgress()
    const pendingActive = deferred<{ data?: unknown }>()
    const resume = progress.resumeActive(() => pendingActive.promise, {
      label: '待恢复任务',
      intervalMs: 300,
      autoClearMs: 0,
      fetchJob: async () => ({ id: 'pending', status: 'completed' }),
    })

    // 还没确认存在活跃任务，不得提前点亮进度层
    expect(progress.running.value).toBe(false)

    pendingActive.resolve({ data: null })
    expect(await resume).toBeNull()
    expect(progress.running.value).toBe(false)
  })

  it('新任务 claim 后旧恢复结果被丢弃；详情缺失按「恢复失败」上报；reset 后旧 owner 失效', async () => {
    const progress = useJobProgress()

    const oldActive = deferred<{ data: JobLike }>()
    const oldResume = progress.resumeActive(() => oldActive.promise, {
      label: '旧任务',
      intervalMs: 300,
      autoClearMs: 0,
      fetchJob: async () => ({ id: 'old', status: 'completed', message: '旧任务完成' }),
    })

    const owner = progress.begin()
    const newPoll = progress.pollJob(
      'new',
      {
        label: '新任务',
        intervalMs: 300,
        autoClearMs: 0,
        fetchJob: async () => ({ id: 'new', status: 'completed', message: '新任务完成', done: 1, total: 1 }),
      },
      owner
    )

    oldActive.resolve({ data: { id: 'old', status: 'running', done: 0, total: 1 } })
    // 新任务 claim 之后，旧的恢复链路不得再返回结果
    expect(await oldResume).toBeNull()

    const finished = await newPoll
    expect(finished?.id).toBe('new')
    expect(progress.job.value?.id).toBe('new')
    expect(progress.text.value).toBe('新任务完成')
    expect(progress.running.value).toBe(false)
    expect(progress.owns(owner)).toBe(true)

    // 恢复流程遇到详情缺失：必须报「恢复失败」，不得当成任务已完成
    const missingResume = await progress.resumeActive(
      () => Promise.resolve({ data: { id: 'lost-job', status: 'running', total: 2 } }),
      {
        label: '丢失详情',
        intervalMs: 300,
        autoClearMs: 0,
        fetchJob: async () => null,
      }
    )
    expect(missingResume).toBeNull()
    expect(progress.running.value).toBe(false)
    expect(progress.text.value).toMatch(/恢复失败/)
    expect(progress.job.value?.status).toBe('failed')

    const staleOwner = owner
    progress.reset()
    expect(progress.owns(staleOwner)).toBe(false)
    expect(progress.job.value).toBeNull()
    expect(progress.text.value).toBe('')
  })

  it('详情缺失（null / 空对象）不得被当成已完成：连续读不到详情按未知状态失败', async () => {
    const progress = useJobProgress()
    let fetches = 0
    const poll = progress.pollJob(
      'missing-detail',
      {
        intervalMs: 300,
        autoClearMs: 0,
        fetchJob: async () => {
          fetches++
          return {}
        },
      },
      progress.begin()
    )

    await expect(poll).rejects.toThrow(/任务详情缺失/)
    // 详情缺失必须重试到上限才判定未知
    expect(fetches).toBe(3)
    expect(progress.running.value).toBe(false)
  })

  it('轮询休眠期间 reset：sleep 结束后不得再发出任何请求', async () => {
    const progress = useJobProgress()
    let fetchesAfterReset = 0
    const owner = progress.begin()
    const poll = progress.pollJob(
      'sleeping',
      {
        intervalMs: 300,
        autoClearMs: 0,
        fetchJob: async () => {
          fetchesAfterReset++
          return { id: 'sleeping', status: 'completed' }
        },
      },
      owner
    )

    await new Promise((resolve) => setTimeout(resolve, 20))
    progress.reset()

    expect(await poll).toBeNull()
    expect(fetchesAfterReset).toBe(0)
  })
})
