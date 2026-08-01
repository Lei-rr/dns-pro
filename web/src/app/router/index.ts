import { createRouter, createWebHashHistory, type RouteLocationNormalized } from 'vue-router'
import { getCachedProvider, loadProviders } from '@/features/providers'
import { useSessionStore } from '@/features/auth'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'

// 静态导入：切换页面不再 lazy chunk「加载中」
import AppLayout from '@/app/layouts/AppLayout.vue'
import LoginPage from '@/pages/login/LoginPage.vue'
import DashboardPage from '@/pages/dashboard/DashboardPage.vue'
import ProvidersPage from '@/pages/providers/ProvidersPage.vue'
import ProviderEntryPage from '@/pages/provider-entry/ProviderEntryPage.vue'

const systemRouteIds = new Set(['', 'login', 'providers'])

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { public: true } },
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', component: DashboardPage },
        { path: 'providers', component: ProvidersPage },
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
    if (to.path === '/login') return session.authenticated ? '/' : true
    if (!session.authenticated) return '/login'
    return true
  } catch {
    if (to.path === '/login') return true
    return '/login'
  }
}

async function ensureProviderRoute(to: RouteLocationNormalized) {
  const first = firstRouteSegment(to)
  if (systemRouteIds.has(first)) return true
  await loadProviders()
  if (getCachedProvider(first)) return true
  toast.warning('该 DNS 服务商未配置或不可用')
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
