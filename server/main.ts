import type { FastifyInstance } from 'fastify'
import { bootServer } from './app/lifecycle.js'

const SHUTDOWN_TIMEOUT_MS = 10000

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
  // 注册监听器会顶掉 Node 对未处理拒绝的默认 fail-fast，因此这里必须与 uncaughtException 同一策略：
  // 记录后有序退出，不能让状态不可信的进程继续服务
  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ err: reason }, 'unhandled rejection')
    shutdown('unhandledRejection', 1)
  })
}

async function main(): Promise<void> {
  // 启动阶段顺序见 app/lifecycle.ts 的 STARTUP_STAGES（fail-fast）
  const { app, config } = await bootServer()
  registerShutdown(app)
  await app.listen({ host: config.host, port: config.port })
  console.log(`dns-pro listening at http://${config.host}:${config.port}`)
}

main().catch((err) => {
  console.error('启动失败：', err instanceof Error ? err.message : err)
  process.exit(1)
})
