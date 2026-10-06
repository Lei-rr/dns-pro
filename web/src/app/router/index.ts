import { createRouter, createWebHashHistory, type RouteLocationNormalized, type RouteRecordRaw } from 'vue-router'
import { useSessionStore } from '@/features/auth'
import { toast } from '@/shared/lib/toast'
import { encodePath } from '@/shared/lib/path'

// 静态导入：切换页面不再 lazy chunk「加载中」
import AppLayout from '@/app/layouts/AppLayout.vue'
import LoginPage from '@/pages/login/LoginPage.vue'
import DashboardPage from '@/pages/dashboard/DashboardPage.vue'
import ProvidersPage from '@/pages/providers/ProvidersPage.vue'
import ProviderEntryPage from '@/pages/provider-entry/ProviderEntryPage.vue'

// 与后端保留字（server/core/providers/provider-normalizer.ts 的 RESERVED_PROVIDER_IDS = home/login/providers/user）
// 不同：这里只是前端路由表里出现过的首段。'p' 是服务商页面前缀，故首段无法用来判断服务商是否存在——
// 存在性校验放在 ProviderEntryPage（未找到时提示并回首页），守卫只负责登录态。
/**
 * 路由表：导出供测试直接断言结构。
 *
 * 匹配顺序由 vue-router 按路径 score 决定，与声明顺序无关；兜底路由负责把未匹配路径送回首页。
 */
export const routes: RouteRecordRaw[] = [
  { path: '/login', component: LoginPage, meta: { public: true } },
  // 未匹配路径（含三段以上）回首页，避免空白页。
  { path: '/:pathMatch(.*)*', redirect: '/' },
  {
    path: '/',
    component: AppLayout,
    children: [
      { path: '', component: DashboardPage },
      { path: 'providers', component: ProvidersPage },
      // 服务商页面统一加 /p 前缀：后端只保留 home/login/providers/user，任何其它 ID 都可以创建，
      // 前缀让服务商 ID 与 /providers 等系统路由彻底错开，否则同名服务商页面永远不可达。
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
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

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

router.beforeEach(async (to) => ensureAuthenticated(to))

export default router
