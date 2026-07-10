import { createRouter, createWebHashHistory } from 'vue-router'
import { authApi } from '@/modules/system/api/auth'
import { loadProviders } from '@/stores/providers'
import { message } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'
import { resolveChildRoute, resolveEntryRoute, selectedMenuKey } from './routes/utils'

const AppLayout = () => import(/* webpackChunkName: "layout" */ '@/modules/system/layouts/AppLayout.vue')
const LoginView = () => import(/* webpackChunkName: "login" */ '@/modules/system/views/LoginView.vue')
const DashboardView = () => import(/* webpackChunkName: "dashboard" */ '@/modules/system/views/DashboardView.vue')
const ProviderSettingsView = () => import(/* webpackChunkName: "provider-settings" */ '@/modules/provider/views/ProviderSettingsView.vue')
const ProviderRouteView = () => import(/* webpackChunkName: "provider-route" */ '@/shared/components/ProviderRouteView.vue')

export const systemRouteIds = new Set(['', 'login', 'providers'])

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true } },
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', component: DashboardView },
        { path: 'providers', component: ProviderSettingsView },
        { path: ':provider', component: ProviderRouteView },
        { path: ':provider/:second', component: ProviderRouteView, props: { child: true } },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  if (to.path === '/login') return true

  try {
    await authApi.me()
  } catch {
    return '/login'
  }

  const first = to.path.split('/').filter(Boolean)[0] || ''
  if (systemRouteIds.has(first)) return true

  try {
    const providers = await loadProviders()
    const parts = to.path.split('/').filter(Boolean)
    if (parts[1] ? resolveChildRoute(providers, first, parts[1]) : resolveEntryRoute(providers, first)) return true
    message.warning('该 DNS 服务商未配置或不可用')
    return '/'
  } catch (error) {
    message.error(errorMessage(error))
    return '/'
  }
})

export default router

export { selectedMenuKey }
