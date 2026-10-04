import type { FastifyInstance } from 'fastify'
import { noRequestSchema } from '../../../core/http/request-schema.js'
import {
  createSessionHandler,
  deleteSessionHandler,
  getSessionHandler,
  updatePasswordHandler,
} from './auth.handlers.js'
import { passwordUpdateSchema, sessionStoreSchema } from './auth.schema.js'

/** 公开：会话建立/查询/注销 */
export async function routes(app: FastifyInstance) {
  app.post(
    '/session',
    {
      schema: sessionStoreSchema,
      config: { rateLimit: { max: 5, timeWindow: 15 * 60 * 1000 } },
    },
    createSessionHandler
  )
  app.get('/session', { schema: noRequestSchema }, getSessionHandler)
  app.delete('/session', { schema: noRequestSchema }, deleteSessionHandler)
}

/** 需登录：修改密码（默认凭据下唯一放行的业务接口） */
export async function protectedRoutes(app: FastifyInstance) {
  app.post(
    '/password',
    {
      schema: passwordUpdateSchema,
      config: {
        allowDefaultCredential: true,
        // 与登录同级别限流：防止持有会话后暴力猜测当前密码
        rateLimit: { max: 5, timeWindow: 15 * 60 * 1000 },
      },
    },
    updatePasswordHandler
  )
}
