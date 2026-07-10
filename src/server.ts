import { buildApp } from './app.js'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 2022)

const app = buildApp()

try {
  await app.listen({ host, port })
  app.log.info(`dns-pro server listening at http://${host}:${port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
