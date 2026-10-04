import { createRouter, createWebHashHistory, type RouteLocationNormalized } from 'vue-router'
import { getCachedProviderAny, loadProviders } from '@/features/providers'
import { useSessionStore } from '@/features/auth'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'

// 静态导入：切换页面不再 lazy chunk「加载中」
import AppLayout from '@/app/layouts/AppLayout.vue'
import LoginPage from '@/pages/login/LoginPage.vue'
import DashboardPage from '@/pages/dashboard/DashboardPage.vue'
import ProvidersPage from '@/pages/providers/ProvidersPage.vue'
import SyncPage from '@/pages/sync/SyncPage.vue'
import ProviderEntryPage from '@/pages/provider-entry/ProviderEntryPage.vue'

const systemRouteIds = new Set(['', 'login', 'providers', 'sync'])

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
        { path: ':provider', component: ProviderEntryPage },
        { path: ':provider/:second', component: ProviderEntryPage, props: { child: true } },
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
