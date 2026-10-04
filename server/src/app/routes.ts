import type { FastifyInstance } from 'fastify'
import { authRequired } from '../kernel/security/auth-required.js'
import { routes as systemPublicRoutes } from '../domains/system/health/system.routes.js'
import { protectedRoutes as authProtectedRoutes, routes as authRoutes } from '../domains/system/auth/auth.routes.js'
import { routes as providerRoutes } from '../use-cases/provider-management/provider-management.routes.js'
import { routes as cloudflareRoutes } from '../domains/cloudflare/cloudflare.routes.js'
import { routes as dnspodRoutes } from '../domains/dnspod/dns-pod.routes.js'
import { createDnsBatchRoutes } from '../use-cases/dns-batch/dns-batch.routes.js'
import { routes as saasRoutes } from '../domains/cloudflare/saas/saas.routes.js'
import { routes as saasDnsSyncRoutes } from '../use-cases/saas-dns-sync/saas-dns-sync.routes.js'
import { routes as edgeoneRoutes } from '../domains/edgeone/edge-one.routes.js'
import { routes as edgeOneDnsSyncRoutes } from '../use-cases/edge-one-dns-sync/edge-one-dns-sync.routes.js'
import { routes as cloudflaredRoutes } from '../domains/cloudflare/tunnel/tunnel.routes.js'
import { routes as auditRoutes } from '../domains/system/audit/audit.routes.js'
import { routes as reconcileRoutes } from '../use-cases/derived-records/reconcile.routes.js'

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
