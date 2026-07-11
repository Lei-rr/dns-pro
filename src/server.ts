import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { buildApp } from './app.js'
import { loadAppConfig, type AppConfig } from './config/app.js'
import { setDataRoot } from './lib/storage/json-store.js'
import { setDefaultHttpTimeout } from './lib/http/base-gateway.js'
import { globalCache } from './lib/cache/cache-service.js'

function parseCliOverrides(): Partial<AppConfig> {
  const overrides: Partial<AppConfig> = {}
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--log-level' && args[i + 1]) {
      overrides.logLevel = args[i + 1]
      i++
    }
  }
  return overrides
}

function printConfigError(err: unknown): never {
  if (err instanceof ZodError) {
    console.error('配置校验失败：')
    for (const issue of err.issues) {
      const field = issue.path.length > 0 ? issue.path.join('.') : 'config'
      console.error(`  - ${field}: ${issue.message}`)
    }
  } else {
    console.error('加载配置失败：', err)
  }
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

const config = (() => {
  try {
    return loadAppConfig(parseCliOverrides())
  } catch (err) {
    printConfigError(err)
  }
})()
setDataRoot(config.dataDir)
setDefaultHttpTimeout(config.httpTimeoutMs)
globalCache.updateOptions({ maxEntries: config.cacheMaxEntries, sweepIntervalMs: config.cacheSweepIntervalMs })

const app = buildApp(config)

registerShutdownHooks(app)

try {
  await app.listen({ host: config.host, port: config.port })
  app.log.info(`dns-pro server listening at http://${config.host}:${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
