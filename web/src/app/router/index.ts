import { createRouter, createWebHashHistory, type RouteLocationNormalized } from 'vue-router'
import { getCachedProviderAny, loadProviders } from '@/features/providers'
import { useSessionStore } from '@/features/auth'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { encodePath } from '@/shared/lib/path'

// 静态导入：切换页面不再 lazy chunk「加载中」
import AppLayout from '@/app/layouts/AppLayout.vue'
import LoginPage from '@/pages/login/LoginPage.vue'
import DashboardPage from '@/pages/dashboard/DashboardPage.vue'
import ProvidersPage from '@/pages/providers/ProvidersPage.vue'
import SyncPage from '@/pages/sync/SyncPage.vue'
import ProviderEntryPage from '@/pages/provider-entry/ProviderEntryPage.vue'

// 与后端保留字（server/core/providers/provider-normalizer.ts 的 RESERVED_PROVIDER_IDS）同一口径：
// 这些首段永远不会是服务商 ID，守卫无需做服务商存在性校验；'p' 是服务商详情的前缀（见下方 routes）。
const systemRouteIds = new Set(['', 'home', 'login', 'p', 'providers', 'sync', 'user'])

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { public: true } },
    // 未匹配路径（含三段以上）回首页，避免空白页。
    { path: '/:pathMatch(.*)*', redirect: '/' },
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', component: DashboardPage },
        { path: 'providers', component: ProvidersPage },
        { path: 'sync', component: SyncPage },
        // 服务商页面统一加 /p 前缀：后端只保留 home/login/providers/user，任何其它 ID（含 sync）都可以创建，
        // 前缀让服务商 ID 与 /sync、/providers 等系统路由彻底错开，否则同名服务商页面永远不可达。
        { path: 'p', redirect: '/' },
        { path: 'p/:provider', component: ProviderEntryPage },
        { path: 'p/:provider/:second', component: ProviderEntryPage, props: { child: true } },
        // 兼容旧链接（书签与其它 feature 内的相对跳转）：/:provider[/:second] → /p/:provider[/:second]
        { path: ':provider', redirect: (to) => `/p/${encodePath(String(to.params.provider))}` },
        {
          path: ':provider/:second',
          redirect: (to) => `/p/${encodePath(String(to.params.provider))}/${encodePath(String(to.params.second))}`,
        },
      ],
    },
  ],
})

function firstRouteSegment(to: RouteLocationNormalized) {
  return to.path.split('/').filter(Boolean)[0] || ''
}

async function ensureAuthenticated(to: RouteLocationNormalized) {
  try {
    const session = await useSessionStore().load()
    if (to.meta.public) return session.authenticated ? '/' : true
    if (!session.authenticated) return '/login'
    return true
  } catch {
    // 会话检查失败（网络/服务异常）与未登录不同：提示后按未登录处理，下次导航会自动重试
    toast.error('会话状态检查失败，请刷新页面重试')
    if (to.meta.public) return true
    return '/login'
  }
}

async function ensureProviderRoute(to: RouteLocationNormalized) {
  const first = firstRouteSegment(to)
  if (systemRouteIds.has(first)) return true
  await loadProviders()
  if (getCachedProviderAny(first)) return true
  toast.warning('未找到该服务商')
  return '/'
}

router.beforeEach(async (to) => {
  const authResult = await ensureAuthenticated(to)
  if (authResult !== true) return authResult
  try {
    return await ensureProviderRoute(to)
  } catch (error) {
    toast.error(errorMessage(error))
    return '/'
  }
})

export default router
