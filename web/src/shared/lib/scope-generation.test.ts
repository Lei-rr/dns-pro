import { describe, expect, it } from 'vitest'
import { createScopeGeneration } from './scope-generation'

/**
 * scope generation：路由 / 供应商 / zone 切换后，旧 scope 的异步动作必须全部失效。
 * 迁移自 scripts/isolated-job-progress-probe.ts（探针已退役）。
 * 这里是顺序敏感的竞态场景（延迟确认、在飞响应），保持单个 it 内的顺序流程。
 */

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('scope generation', () => {
  it('确认弹窗跨路由：capture 快照不可变，invalidate 后旧 scope 的迟到来确认不得 POST / toast / 改列表', async () => {
    const scopeGeneration = createScopeGeneration()
    const capturedScope = scopeGeneration.capture({ providerId: 'provider-a', zoneName: 'zone-a' })
    const confirmation = deferred<boolean>()
    let scopedPosts = 0
    let scopedToasts = 0
    let scopedMutations = 0

    const staleScopedAction = (async () => {
      if (!(await confirmation.promise) || !capturedScope.active()) return
      scopedPosts++
      await Promise.resolve()
      if (!capturedScope.active()) return
      scopedToasts++
      scopedMutations++
    })()

    scopeGeneration.invalidate()
    const replacementScope = scopeGeneration.capture({ providerId: 'provider-b', zoneName: 'zone-b' })
    confirmation.resolve(true)
    await staleScopedAction

    expect(capturedScope.active()).toBe(false)
    expect(capturedScope.value).toEqual({ providerId: 'provider-a', zoneName: 'zone-a' })
    expect(replacementScope.active()).toBe(true)
    expect(replacementScope.value).toEqual({ providerId: 'provider-b', zoneName: 'zone-b' })
    // 迟到的确认不得把请求打到新 scope 上
    expect(scopedPosts).toBe(0)
    expect(scopedToasts).toBe(0)
    expect(scopedMutations).toBe(0)
  })

  it('claim 快照值而非引用：后一次 claim 让前一次立即失效（弹窗保存/删除/表单提交的互斥前提）', () => {
    const exclusiveScope = createScopeGeneration()
    const mutableScope = { providerId: 'provider-a', zoneName: 'zone-a' }
    const firstClaim = exclusiveScope.claim(mutableScope)
    mutableScope.providerId = 'mutated-provider'
    const secondClaim = exclusiveScope.claim({ providerId: 'provider-b', zoneName: 'zone-b' })

    expect(firstClaim.active()).toBe(false)
    // 快照必须绑定 claim 时刻的值，之后外部改动不得穿透
    expect(firstClaim.value).toEqual({ providerId: 'provider-a', zoneName: 'zone-a' })
    expect(secondClaim.active()).toBe(true)
    expect(secondClaim.value).toEqual({ providerId: 'provider-b', zoneName: 'zone-b' })
  })

  it('在飞响应回到已失效 scope：不得 toast / 改列表', async () => {
    const inFlightScope = createScopeGeneration()
    const inFlightOwner = inFlightScope.capture({ providerId: 'provider-a', zoneName: 'zone-a' })
    const postResponse = deferred<void>()
    let inFlightToasts = 0
    let inFlightMutations = 0

    const inFlightAction = (async () => {
      await postResponse.promise
      if (!inFlightOwner.active()) return
      inFlightToasts++
      inFlightMutations++
    })()

    inFlightScope.invalidate()
    postResponse.resolve()
    await inFlightAction

    expect(inFlightToasts).toBe(0)
    expect(inFlightMutations).toBe(0)
  })
})
