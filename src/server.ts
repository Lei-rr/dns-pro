import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { buildApp } from './app.js'
import { loadAppConfig } from './config/app.js'
import { setDataRoot } from './support/json-store.js'

function printConfigError(err: unknown): never {
  if (err instanceof ZodError) {
    console.error('配置校验失败，请检查环境变量：')
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
    return loadAppConfig()
  } catch (err) {
    printConfigError(err)
  }
})()
setDataRoot(config.dataDir)
process.env.HTTP_TIMEOUT_MS = String(config.httpTimeoutMs)

const app = buildApp(config)

registerShutdownHooks(app)

try {
  await app.listen({ host: config.host, port: config.port })
  app.log.info(`dns-pro server listening at http://${config.host}:${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
