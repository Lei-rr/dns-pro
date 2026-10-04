import type { FastifyInstance } from 'fastify'
import { applyReconcileHandler, detectReconcileHandler } from './reconcile.handlers.js'
import { reconcileApplySchema, reconcileDetectSchema } from './reconcile.schema.js'

/** 健康视图 / 对账 / 修复 API（F1/F2）：挂在 /api/reconcile */
export async function routes(app: FastifyInstance): Promise<void> {
  app.get('/', { schema: reconcileDetectSchema }, detectReconcileHandler)
  app.post('/', { schema: reconcileApplySchema }, applyReconcileHandler)
}
