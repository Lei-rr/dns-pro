import { dnsEffectNote, dnsEffectOf, type BatchItemResult } from '../../core/jobs/batch-job.js'
import type { SideEffects } from '../../core/providers/side-effect-result.js'

/**
 * 更新主机名的结果 → 批量条目结果（批量修改与优选切换共用）。
 * 判定顺序固定：本地偏好保存失败优先于 DNS 写回失败——本地失败时 updateHostname 不写 DNS。
 */
export function itemResultFromSideEffects(
  updated: Record<string, unknown>,
  options: {
    /** 成功条目消息；DNS 已写回时由本函数追加后缀 */
    successMessage: string
    /** 条目业务字段（primary_applied / preferred_domain 等） */
    extra?: Record<string, unknown>
    /** 远端已应用但本地偏好保存失败时的消息前缀 */
    localFailureMessage?: string
    /** DNS 写回失败时的消息前缀 */
    syncFailureMessage?: string
    /** 未开启自动同步：忽略 DNS 副作用，也不记 dns_sync_status */
    autoSync?: boolean
  }
): BatchItemResult {
  const base = options.extra ?? {}
  const local = (updated as { side_effects?: SideEffects }).side_effects?.local?.preference
  if (local?.status === 'failed') {
    const prefix = options.localFailureMessage ?? '远端配置已更新，但本地偏好保存失败'
    return {
      status: 'failed',
      message: `${prefix}：${local.message || '未知错误'}`,
      extra: { ...base, local_preference_status: 'failed' },
    }
  }
  if (options.autoSync === false) return { status: 'success', message: options.successMessage, extra: base }

  const sync = dnsEffectOf(updated, 'sync')
  if (sync?.status === 'failed') {
    const prefix = options.syncFailureMessage ?? '配置已更新，但 DNS 写回失败'
    return {
      status: 'failed',
      message: `${prefix}：${sync.message || '未知错误'}`,
      extra: { ...base, dns_sync_status: 'failed' },
    }
  }
  return {
    status: 'success',
    message: `${options.successMessage}${dnsEffectNote(sync, 'DNS 已写回')}`,
    extra: { ...base, dns_sync_status: sync?.status ?? 'unknown' },
  }
}
