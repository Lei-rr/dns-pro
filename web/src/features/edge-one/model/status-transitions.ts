/**
 * 上下线指令的过渡态（EdgeOne 加速域名）：
 * 停止/启用是异步的，指令下发后到状态落定之间有数秒到数分钟的窗口。
 * 这里只描述「哪些行正处于过渡中」，不参与状态机本身——
 * 行数据始终是服务端真相，过渡态是叠加在其上的展示层信息。
 */

/** 待落定的上下线指令：目标状态 + 是否已观察到上游进入 process（用于识别失败回退） */
export type PendingStatusTransition = { target: 'online' | 'offline'; enteredTransition: boolean }

/** 行键（domainName）→ 待落定指令 */
export type PendingStatusTransitions = Map<string, PendingStatusTransition>

/**
 * 过渡中的行键：指令已下发、尚未落定的行。
 * 服务端在指令被接受前可能仍返回旧状态，因此这些行不能照旧值渲染：
 * 否则「停止加速」入口会在指令在途时重新出现，用户可重复下发；删除入口也会误开。
 */
export function transitioningKeys(pending: PendingStatusTransitions): string[] {
  return Array.from(pending.keys())
}

/** 行展示状态：过渡中的行一律按 process 展示，其余用服务端状态（统一小写） */
export function displayDomainStatus(status: string | null | undefined, transitioning: boolean): string {
  if (transitioning) return 'process'
  return String(status || '').toLowerCase()
}
