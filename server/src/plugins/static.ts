import path from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import fastifyStatic from '@fastify/static'
import fastifyCompress from '@fastify/compress'

const distDir = path.resolve(process.cwd(), 'web/dist')

/**
 * 静态资源：@fastify/compress + @fastify/static（根目录固定为 web/dist，库内置目录穿越防护，拒绝点文件）。
 * 使用 fp 以便错误处理插件的 SPA 回退可调用 reply.sendFile。
 */
const staticPluginImpl: FastifyPluginAsync = async (app) => {
  await app.register(fastifyCompress)

  // 带哈希的构建产物：长缓存
  await app.register(fastifyStatic, {
    root: path.join(distDir, 'assets'),
    prefix: '/assets/',
    wildcard: true,
    decorateReply: false,
    maxAge: '1y',
    immutable: true,
    dotfiles: 'deny',
  })

  // 应用外壳：index.html 禁止缓存
  await app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    wildcard: false,
    index: false,
    dotfiles: 'deny',
    decorateReply: true,
    setHeaders(reply, filePath) {
      if (filePath.endsWith('index.html')) {
        reply.header('Cache-Control', 'no-store, must-revalidate')
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        reply.header('Cache-Control', 'public, max-age=3600')
      }
    },
  })
}

export const staticPlugin = fp(staticPluginImpl, {
  name: 'static',
  fastify: '5.x',
})
