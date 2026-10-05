import type { FastifyBaseLogger, FastifyRequest } from 'fastify'
import type { AppConfig } from './config.js'
import type { AppModules } from './modules.js'
import { createWorkflows } from './workflows.js'
import type { JobService } from '../core/jobs/job.service.js'
import type { AuditLog } from '../core/observability/audit-log.js'
import { storePath } from '../core/store/store-registry.js'

/** 平台设施：单进程内存任务执行器 + 关键操作审计（F6）+ 只读会话判定 */
export type AppPlatform = { jobs: JobService; audit: AuditLog; session: SessionProbe }

/**
 * 只读会话判定：由装配层注入（app → modules）。
 * modules 之间禁止互相引用，需要「当前请求是否已登录」时统一走这里。
 */
type SessionProbe = (request: FastifyRequest) => Promise<string | null>

/** 装配完成的运行上下文：config / platform / modules / workflows 四层 */
export type AppContext = {
  config: AppConfig
  platform: AppPlatform
  modules: AppModules
  workflows: ReturnType<typeof createWorkflows>
  /** 首次启动生成的初始密码（仅启动日志输出一次） */
  initialPassword: string | null
}

/** 启动预热：加载持久化数据、清理孤儿偏好 */
export async function startAppContext(ctx: AppContext, log: FastifyBaseLogger): Promise<void> {
  const providers = await ctx.modules.providers.repository.all()
  await Promise.all([ctx.modules.saas.preferredDomains.list(), ctx.modules.saas.preferences.listAll()])

  const cloudflareIds = new Set(providers.filter((p) => p.type === 'cloudflare').map((p) => p.id))
  const pruned = await ctx.modules.saas.preferences.pruneOrphans(cloudflareIds, new Set(providers.map((p) => p.id)))
  if (pruned.removedCount || pruned.repairedCount) log.info(pruned, 'pruned orphan SaaS preferences')

  // 升级旧版本遗留的明文密码
  if (await ctx.modules.auth.service.upgradePlaintextCredential()) {
    log.info(`upgraded plaintext credential in data/${storePath('auth')} to a scrypt hash`)
  }
  if (ctx.initialPassword) {
    // 密码单独成行，便于从日志中复制
    const lines = [
      `[SECURITY] 已生成初始密码："${ctx.initialPassword}"`,
      `[SECURITY] 请登录后立即修改；如遗失，可在 data/${storePath('auth')} 写入 auth.password 后重启重置`,
    ]
    for (const line of lines) log.warn(line)
    console.warn(lines.map((line) => `\x1b[33m${line}\x1b[0m`).join('\n'))
  }
  if (await ctx.modules.auth.service.isDefaultCredential()) {
    const message = '[SECURITY WARNING] 仍在使用默认账号密码 admin/admin，请登录后立即修改密码'
    log.warn(message)
    console.warn(`\x1b[33m${message}\x1b[0m`)
  }
}
