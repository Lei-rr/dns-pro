import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { AppContext } from '../bootstrap/create-context.js'

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext
  }
}

/** 根级注入应用上下文，所有作用域可通过 app.ctx / request.server.ctx 访问 */
const appContextPluginImpl: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  app.decorate('ctx', opts.ctx)
}

export const appContextPlugin = fp(appContextPluginImpl, { name: 'app-context', fastify: '5.x' })
