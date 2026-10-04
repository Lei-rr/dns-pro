import type { FastifyReply, FastifyRequest } from 'fastify'
import { noContent, success } from '../../../kernel/http/api-response.js'
import { noRequestSchema, type RequestOf } from '../../../kernel/http/request-schema.js'
import { auditActor } from '../../../kernel/observability/audit-log.js'
import type { passwordUpdateSchema, sessionStoreSchema } from './auth.schema.js'

export async function createSessionHandler(
  request: FastifyRequest<RequestOf<typeof sessionStoreSchema>>,
  reply: FastifyReply
) {
  const { username, password } = request.body
  return reply.send(success(await request.server.ctx.modules.auth.service.login(reply, username, password, request.ip)))
}

export async function getSessionHandler(
  request: FastifyRequest<RequestOf<typeof noRequestSchema>>,
  reply: FastifyReply
) {
  return reply.send(success(await request.server.ctx.modules.auth.service.currentSession(request)))
}

export async function deleteSessionHandler(
  request: FastifyRequest<RequestOf<typeof noRequestSchema>>,
  reply: FastifyReply
) {
  // 操作者必须在注销前解析（注销会清空会话 Cookie）
  const actor = await auditActor(request)
  await request.server.ctx.modules.auth.service.logout(request, reply)
  request.server.ctx.platform.audit.record({
    action: 'session_revoked',
    actor,
    target: 'auth.session',
    detail: { reason: 'logout' },
  })
  return reply.status(204).send(noContent())
}

export async function updatePasswordHandler(
  request: FastifyRequest<RequestOf<typeof passwordUpdateSchema>>,
  reply: FastifyReply
) {
  const { current_password: currentPassword, new_password: newPassword } = request.body
  const actor = await auditActor(request)
  const session = await request.server.ctx.modules.auth.service.changePassword(
    reply,
    currentPassword,
    newPassword,
    request.ip
  )
  request.log.info('auth.password_changed')
  request.server.ctx.platform.audit.record({
    action: 'credential_change',
    actor,
    target: 'auth.password',
    detail: { sessions_revoked: true },
  })
  return reply.send(success(session))
}
