import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { loadAppConfig, type AppConfig } from './bootstrap/app-config.js'
import { resolveSessionSecret } from './shared/auth/session-secret.js'
import { setDataRoot } from './platform/storage/json-store.js'
import { setDefaultHttpTimeout } from './shared/providers/base.client.js'
import { ensureDataDirs } from './platform/storage/ensure-data-dirs.js'

function parseCliOverrides(): Partial<AppConfig> {
  const overrides: Partial<AppConfig> = {}
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--log-level' && args[i + 1]) {
      overrides.logLevel = args[i + 1]
      i++
      continue
    }
    if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
      const port = Number(args[i + 1])
      if (Number.isFinite(port) && port > 0) {
        overrides.port = port
      }
      i++
    }
  }
  return overrides
}

function printConfigError(err: unknown): never {
  console.error('加载配置失败：', err)
  process.exit(1)
}

const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const

function registerShutdownHooks(app: FastifyInstance) {
  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      app.log.info({ signal }, 'received shutdown signal, closing server...')
      app.close().then(
        () => process.exit(0),
        (err) => {
          app.log.error(err)
          process.exit(1)
        }
      )
    })
  }
}

const baseConfig = (() => {
  try {
    return loadAppConfig(parseCliOverrides())
  } catch (err) {
    printConfigError(err)
  }
})()
setDataRoot(baseConfig.dataDir)
await ensureDataDirs(baseConfig.dataDir)
const config: AppConfig = {
  ...baseConfig,
  sessionSecret: await resolveSessionSecret(baseConfig.dataDir, baseConfig.sessionSecret),
}
setDefaultHttpTimeout(config.httpTimeoutMs)

const app = await buildApp(config)

registerShutdownHooks(app)

try {
  await app.listen({ host: config.host, port: config.port })
  app.log.info(`dns-pro server listening at http://${config.host}:${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
