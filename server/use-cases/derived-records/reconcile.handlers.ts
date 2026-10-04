import type { FastifyReply, FastifyRequest } from 'fastify'
import { success } from '../../core/http/api-response.js'
import type { RequestOf } from '../../core/http/request-schema.js'
import type { ReconcileScope, SourceKind } from './derived-record.types.js'
import { reconcileApplySchema, reconcileDetectSchema } from './reconcile.schema.js'

type ScopeInput = { provider_id?: string; kind?: SourceKind }

function scopeOf(input: ScopeInput): ReconcileScope {
  return {
    ...(input.provider_id ? { providerId: input.provider_id } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
  }
}

/** F1 健康视图 / F2 检测：只读扫描派生关系，返回漂移状态（不写远端） */
export async function detectReconcileHandler(
  request: FastifyRequest<RequestOf<typeof reconcileDetectSchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.reconcile.detect(scopeOf(request.query))
  return reply.send(success(result))
}

/** F2 手动对账 / F1 一键修复：先只读检测，再把漂移/缺失交给 DnsWriter */
export async function applyReconcileHandler(
  request: FastifyRequest<RequestOf<typeof reconcileApplySchema>>,
  reply: FastifyReply
) {
  const result = await request.server.ctx.workflows.reconcile.reconcile(scopeOf(request.body))
  request.log.info(
    { audit: { action: 'reconcile', scope: result.scope, summary: result.summary } },
    'reconcile.executed'
  )
  return reply.send(success(result))
}
