import type { FastifyInstance } from 'fastify'
import { authRequired } from '../core/security/auth-required.js'
import { routes as systemPublicRoutes } from '../modules/system/health/system.routes.js'
import { protectedRoutes as authProtectedRoutes, routes as authRoutes } from '../modules/system/auth/auth.routes.js'
import { routes as providerRoutes } from '../workflows/provider-management/provider-management.routes.js'
import { routes as cloudflareRoutes } from '../modules/cloudflare/cloudflare.routes.js'
import { routes as dnspodRoutes } from '../modules/dnspod/dns-pod.routes.js'
import { createDnsBatchRoutes } from '../workflows/dns-batch/dns-batch.routes.js'
import { routes as saasRoutes } from '../modules/cloudflare/saas/saas.routes.js'
import { routes as saasDnsSyncRoutes } from '../workflows/saas-dns-sync/saas-dns-sync.routes.js'
import { routes as edgeoneRoutes } from '../modules/edgeone/edge-one.routes.js'
import { routes as edgeOneDnsSyncRoutes } from '../workflows/edge-one-dns-sync/edge-one-dns-sync.routes.js'
import { routes as cloudflaredRoutes } from '../modules/cloudflare/tunnel/tunnel.routes.js'
import { routes as auditRoutes } from '../modules/system/audit/audit.routes.js'
import { routes as reconcileRoutes } from '../workflows/derived-records/reconcile.routes.js'

/**
 * API 路由目录。
 * 公开：健康检查 + 会话；其余业务接口统一挂在鉴权作用域内。
 */
export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(systemPublicRoutes)
  await app.register(authRoutes)

  await app.register(async function authenticatedApi(scope) {
    // onRequest 阶段鉴权：未登录请求不解析请求体
    scope.addHook('onRequest', authRequired)
    await scope.register(authProtectedRoutes, { prefix: '/auth' })
    // F6：关键操作审计留痕查询入口
    await scope.register(auditRoutes, { prefix: '/audit' })
    await scope.register(providerRoutes, { prefix: '/providers' })
    await scope.register(cloudflareRoutes, { prefix: '/cloudflare/providers/:providerId' })
    await scope.register(createDnsBatchRoutes('cloudflare'), { prefix: '/cloudflare/providers/:providerId' })
    await scope.register(dnspodRoutes, { prefix: '/dnspod/providers/:providerId' })
    await scope.register(createDnsBatchRoutes('dnspod'), { prefix: '/dnspod/providers/:providerId' })
    await scope.register(saasRoutes, { prefix: '/saas' })
    await scope.register(saasDnsSyncRoutes, { prefix: '/saas' })
    await scope.register(edgeoneRoutes, { prefix: '/edgeone/providers/:providerId' })
    await scope.register(edgeOneDnsSyncRoutes, { prefix: '/edgeone/providers/:providerId' })
    await scope.register(cloudflaredRoutes, { prefix: '/cloudflared/providers/:providerId' })
    // F1/F2：同步健康视图 + 统一对账入口（检测只读 / 执行经 DnsWriter）
    await scope.register(reconcileRoutes, { prefix: '/reconcile' })
  })
}
