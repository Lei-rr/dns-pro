import path from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import fastifyStatic from '@fastify/static'
import fastifyCompress from '@fastify/compress'

const distDir = path.resolve(process.cwd(), 'web/dist')

/**
 * Official: @fastify/compress + @fastify/static.
 * fp so reply.sendFile is visible to error-handler SPA fallback.
 */
const staticPluginImpl: FastifyPluginAsync = async (app) => {
  await app.register(fastifyCompress)

  // Hashed Vite assets — long cache + disk wildcard (rebuild without restart)
  await app.register(fastifyStatic, {
    root: path.join(distDir, 'assets'),
    prefix: '/assets/',
    wildcard: true,
    decorateReply: false,
    maxAge: '1y',
    immutable: true,
  })

  // App shell files — decorateReply once for sendFile; index.html never long-cached
  await app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    wildcard: false,
    index: false,
    decorateReply: true,
    setHeaders(reply, filePath) {
      if (filePath.endsWith('index.html')) {
        reply.header('Cache-Control', 'no-store, must-revalidate')
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        // favicon / manifest etc.
        reply.header('Cache-Control', 'public, max-age=3600')
      }
    },
  })
}

export const staticPlugin = fp(staticPluginImpl, {
  name: 'static',
  fastify: '5.x',
})
