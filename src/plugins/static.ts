import path from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import fastifyStatic from '@fastify/static'
import fastifyCompress from '@fastify/compress'

const distDir = path.resolve('web/dist')

const staticPluginImpl: FastifyPluginAsync = async (app) => {
  await app.register(fastifyCompress)
  await app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    wildcard: false,
    maxAge: '1y',
    immutable: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate')
      }
    },
  })
}

/** Breaks encapsulation so reply.sendFile is available for SPA fallback. */
export const staticPlugin = fp(staticPluginImpl, {
  name: 'static',
  fastify: '5.x',
})
