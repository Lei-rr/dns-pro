import type { FastifyBaseLogger } from 'fastify'
import { createInitialAuthConfig } from '../modules/auth/auth-config.repository.js'
import { JobService, type JobsFile } from '../platform/jobs/job.service.js'
import { loadCredentialKey } from '../platform/security/credential-key.js'
import { migrateDataRoot } from './data-migrations.js'
import { createStore } from './store-registry.js'
import type { AppConfig } from './app-config.js'
import { createModules } from './create-modules.js'
import { createWorkflows } from './create-workflows.js'

/** 平台设施：单进程持久化任务 */
export type AppPlatform = { jobs: JobService }

/** 应用上下文：config / platform / modules / workflows 四层 */
export async function createAppContext(config: AppConfig, log: FastifyBaseLogger) {
  // 数据结构迁移：创建任何 store 之前完成（迁移前自动整目录备份）
  await migrateDataRoot(config.dataDir, { info: (message) => log.info(message) })
  // 凭据加密密钥：复用已有文件，缺失时生成
  const credentialKey = await loadCredentialKey(config.dataDir)
  // 首次启动生成随机初始密码（只落盘哈希，明文由启动日志输出）
  const initialPassword = await createInitialAuthConfig(config.dataDir)
  // 任务文件由程序读写，紧凑写入以控制体积
  const platform: AppPlatform = {
    jobs: new JobService(createStore<JobsFile>('jobs')),
  }
  const modules = createModules(config, { credentialKey })
  const workflows = createWorkflows(platform, modules)
  return { config, platform, modules, workflows, initialPassword }
}

export type AppContext = Awaited<ReturnType<typeof createAppContext>>

/** 启动预热：加载持久化数据、清理孤儿偏好、恢复未完成任务 */
export async function startAppContext(ctx: AppContext, log: FastifyBaseLogger): Promise<void> {
  const providers = await ctx.modules.providers.repository.all()
  await Promise.all([ctx.modules.saas.preferredDomains.list(), ctx.modules.saas.preferences.listAll()])

  const cloudflareIds = new Set(providers.filter((p) => p.type === 'cloudflare').map((p) => p.id))
  const pruned = await ctx.modules.saas.preferences.pruneOrphans(cloudflareIds, new Set(providers.map((p) => p.id)))
  if (pruned.removedCount || pruned.repairedCount) log.info(pruned, 'pruned orphan SaaS preferences')

  // 清理完成后再恢复任务，避免任务读到孤儿数据
  const resumed = await ctx.platform.jobs.resumeActiveJobs()
  if (resumed) log.info({ resumed }, 'resumed active jobs')

  // 升级旧版本遗留的明文密码
  if (await ctx.modules.auth.service.upgradePlaintextCredential()) {
    log.info('upgraded plaintext credential in data/config.json to a scrypt hash')
  }
  if (ctx.initialPassword) {
    // 密码单独成行，便于从日志中复制
    const lines = [
      `[SECURITY] 已生成初始密码："${ctx.initialPassword}"`,
      '[SECURITY] 请登录后立即修改；如遗失，可在 data/config.json 写入 auth.password 后重启重置',
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
