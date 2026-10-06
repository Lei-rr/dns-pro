import { describe, expect, it } from 'vitest'
import { useRowBusy } from './row-busy'

/**
 * 行级操作的所有权：同一行互斥、不同行可并发；reset（scope 切换）后，
 * 旧任务的 finally 只能释放自己拿到的那份 token，不得清掉新 scope 的忙状态。
 * 迁移自 scripts/isolated-job-progress-probe.ts（探针已退役），竞态保持在一个 it 内的顺序流程。
 */

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useRowBusy', () => {
  it('同一行互斥、不同行并发；reset 后旧 finally 不得清掉新 scope 的忙状态', async () => {
    const rowBusy = useRowBusy()
    const rowA = deferred()
    const rowB = deferred()
    let duplicateCalls = 0
    let oldOwnerActive = true

    const taskA = rowBusy.runBusy('a', async (owner) => {
      await rowA.promise
      oldOwnerActive = owner.active()
    })
    const duplicateA = rowBusy.runBusy('a', async () => {
      duplicateCalls++
    })
    const taskB = rowBusy.runBusy('b', async () => rowB.promise)
    await Promise.resolve()

    expect(rowBusy.isBusy('a')).toBe(true)
    expect(rowBusy.isBusy('b')).toBe(true)
    // 同一行的重复操作必须被丢弃
    expect(duplicateCalls).toBe(0)

    rowBusy.reset()
    const newRowA = deferred()
    const newTaskA = rowBusy.runBusy('a', async () => newRowA.promise)
    expect(rowBusy.isBusy('a')).toBe(true)

    rowA.resolve()
    await Promise.all([taskA, duplicateA])
    expect(oldOwnerActive).toBe(false)
    // 旧 finally 不得清掉新 scope 的忙状态
    expect(rowBusy.isBusy('a')).toBe(true)
    expect(rowBusy.isBusy('b')).toBe(false)

    newRowA.resolve()
    rowB.resolve()
    await Promise.all([newTaskA, taskB])
    expect(rowBusy.busyKeys.value).toEqual([])
  })
})
