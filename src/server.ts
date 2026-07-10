import { buildApp } from './app.js'
import { loadAppConfig } from './config/app.js'
import { setDataRoot } from './support/json-store.js'

const config = loadAppConfig()
setDataRoot(config.dataDir)

const app = buildApp(config)

try {
  await app.listen({ host: config.host, port: config.port })
  app.log.info(`dns-pro server listening at http://${config.host}:${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
