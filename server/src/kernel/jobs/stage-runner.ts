/**
 * 阶段化生命周期（D7）：把多阶段外部副作用声明为显式阶段序列。
 * 调用方只提供「已完成阶段」与「阶段完成记录钩子」，不再维护散落的布尔标记与逐阶段回调。
 */

/** 单个阶段：名称 + 执行体；阶段名由用例定义，内核不认识业务词 */
export interface Stage<TName extends string> {
  readonly name: TName
  /** 执行阶段；返回的补丁随阶段完成一并记录（无产物可返回空） */
  run: () => Promise<Record<string, unknown> | void>
}

/** 阶段化生命周期的推进状态 */
export interface StageLifecycle<TName extends string> {
  /** 已完成阶段：按声明顺序推进，重试时从第一个未完成阶段继续 */
  readonly completed?: readonly TName[]
  /** 阶段完成记录：调用方据此持久化；抛错则不推进（下一阶段不得越过未记录的阶段） */
  readonly onStage?: (name: TName, patch: Record<string, unknown>) => Promise<void>
}

/**
 * 按声明顺序推进阶段：已完成阶段跳过，每阶段成功后立即记录。
 * 顺序即代码（数组），调用方无需在选项里维护布尔标记。
 */
export async function runStages<TName extends string>(
  stages: readonly Stage<TName>[],
  lifecycle: StageLifecycle<TName> = {}
): Promise<void> {
  const completed = new Set(lifecycle.completed ?? [])
  for (const stage of stages) {
    if (completed.has(stage.name)) continue
    const patch = await stage.run()
    completed.add(stage.name)
    if (lifecycle.onStage) await lifecycle.onStage(stage.name, patch ?? {})
  }
}
