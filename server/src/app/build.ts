import type { FastifyInstance } from 'fastify'
import type { AppConfig } from './config.js'
import { assembleApp } from './lifecycle.js'

/** Fastify 装配入口：按 lifecycle 的显式启动阶段完成（进程入口与探针共用） */
export function buildApp(config: AppConfig): Promise<FastifyInstance> {
  return assembleApp(config)
}
