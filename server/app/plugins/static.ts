import path from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import fastifyStatic from '@fastify/static'
import fastifyCompress from '@fastify/compress'

/** 未显式配置时的静态资源根目录（相对进程工作目录；探针直接构造 config 时走这里） */
const DEFAULT_DIST_DIR = 'web/dist'

/** 带哈希的构建产物：一年不可变长缓存（两处声明共用同一数值，ms 供 @fastify/static，秒供响应头） */
const ASSET_MAX_AGE_SECONDS = 60 * 60 * 24 * 365
const ASSET_MAX_AGE_MS = ASSET_MAX_AGE_SECONDS * 1000

/**
 * 静态资源：@fastify/compress + @fastify/static（根目录取 config.webDistDir，库内置目录穿越防护，拒绝点文件）。
 * 使用 fp 以便错误处理插件的 SPA 回退可调用 reply.sendFile。
 */
const staticPluginImpl: FastifyPluginAsync = async (app) => {
  const distDir = path.resolve(app.ctx.config.webDistDir ?? DEFAULT_DIST_DIR)
  await app.register(fastifyCompress)

  // 带哈希的构建产物：长缓存。
  // 实测启动时已存在的文件由下方第二段注册的「具体文件路由」优先命中（通配路由让位），
  // 所以这里只兜底注册之后才出现的文件，实际下发头以下方 setHeaders 为准——两处数值同源，禁止只改一处
  await app.register(fastifyStatic, {
    root: path.join(distDir, 'assets'),
    prefix: '/assets/',
    wildcard: true,
    decorateReply: false,
    maxAge: ASSET_MAX_AGE_MS,
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
        reply.header('Cache-Control', `public, max-age=${ASSET_MAX_AGE_SECONDS}, immutable`)
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
