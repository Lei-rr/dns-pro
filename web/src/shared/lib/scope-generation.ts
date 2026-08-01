export type ScopeOwner<T> = Readonly<{
  value: Readonly<T>
  active: () => boolean
}>

export type GenerationOwner = Readonly<{ active: () => boolean }>

/**
 * Monotonic ownership for route/provider/zone scoped async work.
 * Captured values are immutable snapshots; invalidate makes every prior owner inert.
 */
export function createScopeGeneration() {
  let generation = 0

  function owner(): GenerationOwner {
    const ownerGeneration = generation
    return Object.freeze({ active: () => ownerGeneration === generation })
  }

  function capture<T extends object>(value: T): ScopeOwner<T> {
    const generationOwner = owner()
    const snapshot = Object.freeze({ ...value }) as Readonly<T>
    return Object.freeze({
      value: snapshot,
      active: generationOwner.active,
    })
  }

  /** Start a new exclusive operation and invalidate the previous operation owner. */
  function claim(): GenerationOwner
  function claim<T extends object>(value: T): ScopeOwner<T>
  function claim<T extends object>(value?: T): GenerationOwner | ScopeOwner<T> {
    generation++
    return value ? capture(value) : owner()
  }

  function invalidate() {
    generation++
  }

  return { capture, claim, invalidate }
}
