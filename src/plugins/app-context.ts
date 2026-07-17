import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { AppContext } from '../app-context.js'

export type AppContextPluginOptions = {
  ctx: AppContext
}

/**
 * Root decoration for application context.
 * Uses fastify-plugin so `app.ctx` is available in every encapsulation context
 * (API scopes, module plugins, hooks).
 */
const appContextPluginImpl: FastifyPluginAsync<AppContextPluginOptions> = async (app, opts) => {
  if (app.hasDecorator('ctx')) return
  app.decorate('ctx', opts.ctx)
}

export const appContextPlugin = fp(appContextPluginImpl, {
  name: 'app-context',
  fastify: '5.x',
})
