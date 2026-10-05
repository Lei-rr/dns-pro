/**
 * EdgeOne 加速域名的状态动作可用性（真机实测语义）：
 * - online 时直接删除会被上游拒绝（OperationDenied.AccelerationDomainStatusNotInOffline），必须先停止加速；
 * - 停止是异步的，下发后域名进入 process，期间既不能改状态也不能删除，最终才落为 offline；
 * - 只有 offline 才提供删除入口，即「两步走」：先停止加速，再删除；
 * - offline 是停用后的稳定态，不是终点：停用之后必须能重新启用（走同一条异步过渡），否则单向下线不可逆；
 * - 未知状态（forbidden/init/空）保守处理：不给任何状态动作。
 */
export interface EdgeOneDomainStatusActions {
  /** 可下发停止加速：仅 online */
  canStop: boolean
  /** 可下发启用（恢复加速）：仅 offline */
  canEnable: boolean
  /** 可删除：仅 offline，且是两步走删除的第二步 */
  canRemove: boolean
  /** 上游配置下发中：停止/启用与删除都不可用 */
  configuring: boolean
}

export function edgeOneDomainStatusActions(status?: string): EdgeOneDomainStatusActions {
  const key = String(status || '').toLowerCase()
  return {
    canStop: key === 'online',
    canEnable: key === 'offline',
    canRemove: key === 'offline',
    configuring: key === 'process',
  }
}
