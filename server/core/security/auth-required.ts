import type { FastifyRequest } from 'fastify'
import { ApiError } from '../http/api-error.js'

/**
 * 鉴权钩子（onRequest 阶段，未登录请求不解析请求体）：
 * - 未登录 → 401
 * - 仍在使用默认账号密码 → 403，仅放行标记了 allowDefaultCredential 的路由（改密码）
 */
export async function authRequired(request: FastifyRequest): Promise<void> {
  const auth = request.server.ctx.modules.auth.service
  const actor = await auth.authenticate(request)
  if (!actor) throw new ApiError('unauthenticated', '请先登录', 401)
  // 会话已解析，把操作者留在请求上：审计等下游只读 request，不再回查 modules
  request.authActor = actor

  const config = request.routeOptions?.config
  if (!config?.allowDefaultCredential && (await auth.isDefaultCredential())) {
    throw new ApiError('password_change_required', '仍在使用默认账号密码，请先修改密码', 403)
  }
}
