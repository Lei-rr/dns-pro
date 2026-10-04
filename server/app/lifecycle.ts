import crypto from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { loadAppConfig, parseCliOverrides, type AppConfig } from './config.js'
import { startAppContext, type AppContext, type AppPlatform } from './context.js'
import { createModules, type AppModules } from './modules.js'
import { createWorkflows } from './use-cases.js'
import { registerApiRoutes } from './routes.js'
import { appContextPlugin } from './plugins/app-context.js'
import { errorHandlerPlugin } from './plugins/error-handler.js'
import { securityPlugin } from './plugins/security.js'
import { staticPlugin } from './plugins/static.js'
import { ensureDataDirs } from '../core/store/ensure-dirs.js'
import { storeSubdirectories } from '../core/store/store-registry.js'
import { resolveSessionSecret } from '../core/security/session-secret.js'
import { migrateDataRoot } from '../core/store/migrations.js'
import { loadCredentialKey } from '../core/security/credential-key.js'
import { createInitialAuthConfig } from '../modules/system/auth/auth-config.repository.js'
import { JobService } from '../core/jobs/job.service.js'
import { AuditLog } from '../core/observability/audit-log.js'

type AppWorkflows = ReturnType<typeof createWorkflows>

// 上游传入的请求 ID 仅接受安全字符，防止日志注入
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * 装配状态：字段由各阶段按 STARTUP_STAGES 顺序填充。
 * 顺序即代码，越序读取会立即暴露为运行时错误（不做隐式兜底）。
 */
class Boot {
  config!: AppConfig
  app!: FastifyInstance
  platform!: AppPlatform
  credentialKey!: Buffer
  modules!: AppModules
  workflows!: AppWorkflows
  initialPassword: string | null = null
}

/** 显式启动阶段：顺序即代码；任一阶段抛错即终止启动（fail-fast） */
const STARTUP_STAGES = [
  { name: 'initConfig', run: initConfig },
  { name: 'initStore', run: initStore },
  { name: 'runMigrations', run: runMigrations },
  { name: 'initKernel', run: initKernel },
  { name: 'initDomains', run: initDomains },
  { name: 'initUseCases', run: initUseCases },
  { name: 'recoverJobs', run: recoverJobs },
  { name: 'ready', run: ready },
] as const

/** 用已解析配置装配应用（探针与测试直接注入配置） */
export async function assembleApp(config: AppConfig): Promise<FastifyInstance> {
  const boot = new Boot()
  boot.config = config
  await runStartupStages(boot)
  return boot.app
}

/** 完整启动装配（含配置读取）；不监听端口，监听由进程入口决定 */
export async function bootServer(): Promise<{ app: FastifyInstance; config: AppConfig }> {
  const boot = new Boot()
  await runStartupStages(boot)
  return { app: boot.app, config: boot.config }
}

async function runStartupStages(boot: Boot): Promise<void> {
  for (const stage of STARTUP_STAGES) await stage.run(boot)
}

/** initConfig：读取配置（CLI > env > 默认）+ 解析会话密钥；调用方已注入配置时只补建外壳 */
async function initConfig(boot: Boot): Promise<void> {
  if (!boot.config) {
    const base = loadAppConfig(parseCliOverrides(process.argv.slice(2)))
    boot.config = { ...base, sessionSecret: await resolveSessionSecret(base.dataDir, base.sessionSecret) }
  }
  // HTTP 外壳随配置一同初始化：后续阶段的启动日志统一走 app.log
  boot.app = createHttpShell(boot.config)
}

/** initStore：数据目录（注册表派生子目录） */
async function initStore(boot: Boot): Promise<void> {
  await ensureDataDirs(boot.config.dataDir, storeSubdirectories())
}

/** runMigrations：数据结构迁移（任何 store 创建之前；迁移前自动整目录备份） */
async function runMigrations(boot: Boot): Promise<void> {
  await migrateDataRoot(boot.config.dataDir, { info: (message) => boot.app.log.info(message) })
}

/** initKernel：内核设施（凭据密钥、初始账号、内存任务执行器） */
async function initKernel(boot: Boot): Promise<void> {
  if (boot.config.sessionSecret.trim().length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters')
  }
  boot.platform = {
    jobs: new JobService(),
    // F6：审计权威留痕写日志；内存环形缓冲只为 UI 提供最近事件的查询入口
    audit: new AuditLog((event) => boot.app.log.info({ audit: event }, 'audit')),
  }
  boot.credentialKey = await loadCredentialKey(boot.config.dataDir)
  boot.initialPassword = await createInitialAuthConfig(boot.config.dataDir)
}

/** initDomains：领域模块（厂商 × 产品线，构造注入） */
async function initDomains(boot: Boot): Promise<void> {
  boot.modules = createModules(boot.config, { credentialKey: boot.credentialKey })
}

/** initUseCases：跨模块用例 + 任务运行器注册 */
async function initUseCases(boot: Boot): Promise<void> {
  boot.workflows = createWorkflows(boot.platform, boot.modules)
}

/** recoverJobs：启动预热（持久化数据、孤儿偏好清理、凭据升级） */
async function recoverJobs(boot: Boot): Promise<void> {
  await startAppContext(contextOf(boot), boot.app.log)
}

/** ready：HTTP 装配（上下文插件、路由、关闭钩子） */
async function ready(boot: Boot): Promise<void> {
  const app = boot.app
  await app.register(appContextPlugin, { ctx: contextOf(boot) })
  app.addHook('onClose', async () => {
    await boot.platform.jobs.close()
  })
  await app.register(securityPlugin)
  await app.register(staticPlugin)
  await app.register(errorHandlerPlugin)
  // 个人面板，不做 API 版本前缀
  await app.register(registerApiRoutes, { prefix: '/api' })
}

function contextOf(boot: Boot): AppContext {
  return {
    config: boot.config,
    platform: boot.platform,
    modules: boot.modules,
    workflows: boot.workflows,
    initialPassword: boot.initialPassword,
  }
}

/** HTTP 外壳：日志 / 代理信任 / 请求 ID / 校验器（装配阶段共用同一实例） */
function createHttpShell(config: AppConfig): FastifyInstance {
  return Fastify({
    logger: config.logLevel
      ? {
          level: config.logLevel,
          // 日志脱敏：Cookie、鉴权头、凭据字段
          redact: {
            paths: [
              'req.headers.cookie',
              'req.headers.authorization',
              'res.headers["set-cookie"]',
              '*.password',
              '*.secret_key',
              '*.api_token',
              'err.details.upstream_body',
            ],
            censor: '[REDACTED]',
          },
        }
      : false,
    // 数字表示信任最近 N 跳代理
    trustProxy:
      typeof config.trustProxy === 'number'
        ? (_address: string, hop: number) => hop < (config.trustProxy as number)
        : config.trustProxy,
    // 关闭内置头解析：否则 fastify 会直接采用 X-Request-Id 原值并跳过 genReqId
    requestIdHeader: false,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id']
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID()
    },
    // 路径参数上限需覆盖最长域名（schema 允许 253），默认 100 会让合法域名直接 414
    routerOptions: { maxParamLength: 256 },
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  })
    .withTypeProvider<TypeBoxTypeProvider>()
    .setValidatorCompiler(TypeBoxValidatorCompiler)
}
