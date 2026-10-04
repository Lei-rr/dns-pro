import type { FastifyInstance } from 'fastify'
import { buildApp } from './app/build.js'
import { loadAppConfig, parseCliOverrides, type AppConfig } from './app/config.js'
import { storeSubdirectories } from './kernel/store/store-registry.js'
import { resolveSessionSecret } from './kernel/security/session-secret.js'
import { setDefaultHttpTimeout } from './kernel/http/base-http.client.js'
import { ensureDataDirs } from './kernel/store/ensure-dirs.js'
import { setDataRoot } from './kernel/store/data-root.js'

const SHUTDOWN_TIMEOUT_MS = 10000

async function prepareConfig(): Promise<AppConfig> {
  const base = loadAppConfig(parseCliOverrides(process.argv.slice(2)))
  setDataRoot(base.dataDir)
  await ensureDataDirs(base.dataDir, storeSubdirectories())
  setDefaultHttpTimeout(base.httpTimeoutMs)
  return { ...base, sessionSecret: await resolveSessionSecret(base.dataDir, base.sessionSecret) }
}

/** 优雅退出：停止接收请求 → 等待任务落盘 → 超时强制退出 */
function registerShutdown(app: FastifyInstance): void {
  let shuttingDown = false
  const shutdown = (reason: string, exitCode: number) => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ reason }, 'shutting down')
    setTimeout(() => {
      app.log.error('forced shutdown after timeout')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS).unref()
    app.close().then(
      () => process.exit(exitCode),
      (err) => {
        app.log.error(err)
        process.exit(1)
      }
    )
  }
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => shutdown(signal, 0))
  // 未捕获异常后进程状态不可信：记录并有序退出，由容器/守护进程重启
  process.on('uncaughtException', (err) => {
    app.log.fatal(err, 'uncaught exception')
    shutdown('uncaughtException', 1)
  })
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandled rejection')
  })
}

async function main(): Promise<void> {
  const config = await prepareConfig()
  const app = await buildApp(config)
  registerShutdown(app)
  await app.listen({ host: config.host, port: config.port })
  console.log(`dns-pro listening at http://${config.host}:${config.port}`)
}

main().catch((err) => {
  console.error('启动失败：', err instanceof Error ? err.message : err)
  process.exit(1)
})
