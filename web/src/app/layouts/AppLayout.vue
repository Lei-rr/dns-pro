<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ChevronDown,
  Cloud,
  Globe2,
  LogOut,
  Moon,
  Radar,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Shield,
  Sun,
  UserRound,
} from '@lucide/vue'
import { Button } from '@/shared/ui/button'
import { AppDialog } from '@/shared/ui/dialog'
import { Badge } from '@/shared/ui/badge'
import { AppTooltip } from '@/shared/ui/tooltip'
import { CommandDialog, type CommandItem } from '@/shared/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { loadProviders, providerPath, providerTypeLabel, useProviderStore } from '@/features/providers'
import { useSessionStore } from '@/features/auth'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { cn } from '@/shared/lib/utils'
import type { Component } from 'vue'

const router = useRouter()
const route = useRoute()
const session = useSessionStore()
const providerStore = useProviderStore()
const securityAlertOpen = ref(false)

const commandOpen = ref(false)
const isDark = ref(false)

const providers = computed(() => providerStore.providers || [])
const activeProviderId = computed(() => {
  const first = route.path.split('/').filter(Boolean)[0] || ''
  if (!first || first === 'providers' || first === 'login') return ''
  return first
})

const providerIcons: Record<string, Component> = {
  dnspod: Globe2,
  cloudflare: Cloud,
  saas: Shield,
  edgeone: Radar,
  cloudflared: Server,
}

function iconOf(type: string) {
  return providerIcons[type] || Globe2
}

function isActivePath(href: string) {
  if (href === '/') return route.path === '/'
  return route.path === href || route.path.startsWith(`${href}/`)
}

/** 手机顶栏折叠按钮：显示当前模块名，而不是固定「控制台」 */
const currentNavLabel = computed(() => {
  if (route.path === '/' || route.path === '') return '控制台'
  if (route.path === '/providers' || route.path.startsWith('/providers/')) return '服务商'
  const active = providers.value.find((item) => item.id === activeProviderId.value)
  if (active?.name) return String(active.name)
  return '控制台'
})

const commandItems = computed<CommandItem[]>(() => {
  const list: CommandItem[] = [
    {
      id: 'nav-dashboard',
      title: '控制台',
      subtitle: '查看全局服务商与统计数据',
      category: '导航',
      icon: Globe2,
      action: () => {
        commandOpen.value = false
        router.push('/')
      },
    },
    {
      id: 'nav-providers',
      title: '服务商管理',
      subtitle: '新增、修改与删除 DNS / Tunnel / EdgeOne 服务商',
      category: '导航',
      icon: Settings2,
      action: () => {
        commandOpen.value = false
        router.push('/providers')
      },
    },
  ]

  for (const item of providers.value) {
    list.push({
      id: `provider-${item.id}`,
      title: item.name || item.id,
      subtitle: `跳转至 ${providerTypeLabel(item.type)} 详情`,
      category: '服务商',
      badge: providerTypeLabel(item.type),
      icon: iconOf(item.type),
      action: () => {
        commandOpen.value = false
        router.push(providerPath(item.id))
      },
    })
  }

  list.push(
    {
      id: 'action-theme',
      title: isDark.value ? '切换为浅色模式' : '切换为深色模式',
      category: '快捷操作',
      icon: isDark.value ? Sun : Moon,
      action: () => {
        commandOpen.value = false
        toggleDark()
      },
    },
    {
      id: 'action-refresh-providers',
      title: '刷新服务商列表',
      category: '快捷操作',
      icon: RefreshCw,
      action: async () => {
        commandOpen.value = false
        try {
          await loadProviders({ force: true })
          toast.success('服务商列表已刷新')
        } catch (error) {
          toast.error(errorMessage(error))
        }
      },
    },
    {
      id: 'action-logout',
      title: '退出登录',
      category: '快捷操作',
      icon: LogOut,
      action: () => {
        commandOpen.value = false
        void logout()
      },
    }
  )

  return list
})

function initTheme() {
  const saved = localStorage.getItem('theme')
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark')
    isDark.value = true
  } else {
    document.documentElement.classList.remove('dark')
    isDark.value = false
  }
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    commandOpen.value = !commandOpen.value
  }
}

function closeSecurityAlert() {
  securityAlertOpen.value = false
  sessionStorage.setItem('dismiss_default_credential_alert', '1')
}

onMounted(async () => {
  initTheme()
  window.addEventListener('keydown', handleGlobalKeydown)
  try {
    const s = await session.load()
    if (s.is_default_credential && !sessionStorage.getItem('dismiss_default_credential_alert')) {
      securityAlertOpen.value = true
    }
    await loadProviders()
  } catch (error) {
    toast.error(errorMessage(error))
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
})

async function logout() {
  sessionStorage.removeItem('dismiss_default_credential_alert')
  await session.logout()
  router.replace('/login')
}

function toggleDark() {
  const dark = document.documentElement.classList.toggle('dark')
  isDark.value = dark
  localStorage.setItem('theme', dark ? 'dark' : 'light')
}
</script>

<template>
  <div class="bg-background relative flex min-h-svh flex-col">
    <header class="bg-background/80 backdrop-blur-md sticky top-0 z-50 w-full border-b border-border/60">
      <!-- 手机全宽+内边距；桌面 ~80vw（用户：手机版不用 80%） -->
      <div
        class="mx-auto flex h-14 w-full max-w-none min-w-0 items-center gap-1.5 px-3 sm:h-16 sm:gap-2 sm:px-6 md:w-[80vw] md:px-0"
      >
        <RouterLink to="/" class="mr-2 flex shrink-0 items-center gap-2.5 text-sm font-bold tracking-tight">
          <span
            class="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-xs font-black shadow-xs"
          >
            D
          </span>
          <span class="hidden sm:inline font-bold tracking-tight">DNS-PRO</span>
        </RouterLink>

        <!-- 常驻：控制台 + 各服务商（非「服务商管理」入口） -->
        <nav class="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex">
          <Button variant="ghost" as-child size="sm" class="h-8 shrink-0 px-2.5 text-xs font-medium cursor-pointer">
            <RouterLink
              to="/"
              :class="
                cn(
                  isActivePath('/')
                    ? 'bg-secondary text-secondary-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )
              "
            >
              控制台
            </RouterLink>
          </Button>
          <Button
            v-for="item in providers"
            :key="item.id"
            variant="ghost"
            as-child
            size="sm"
            class="h-8 shrink-0 px-2.5 text-xs font-medium cursor-pointer"
          >
            <RouterLink
              :to="providerPath(item.id)"
              :class="
                cn(
                  activeProviderId === item.id
                    ? 'bg-secondary text-secondary-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )
              "
            >
              {{ item.name }}
            </RouterLink>
          </Button>
        </nav>

        <!-- 手机：折叠业务导航，触发器显示当前模块 -->
        <div class="min-w-0 flex-1 lg:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="sm" class="h-9 max-w-full gap-1 px-2 text-[15px]">
                <span class="truncate">{{ currentNavLabel }}</span>
                <ChevronDown class="size-4 shrink-0 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-52">
              <DropdownMenuItem as-child>
                <RouterLink to="/" class="w-full" :class="cn(isActivePath('/') && 'bg-accent text-accent-foreground')">
                  控制台
                </RouterLink>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem v-for="item in providers" :key="item.id" as-child>
                <RouterLink
                  :to="providerPath(item.id)"
                  class="w-full"
                  :class="cn(activeProviderId === item.id && 'bg-accent text-accent-foreground')"
                >
                  {{ item.name }}
                </RouterLink>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div class="ml-auto flex shrink-0 items-center gap-1.5">
          <!-- 快捷搜索命令入口 -->
          <AppTooltip content="快捷搜索与跳转 (⌘K)">
            <Button
              variant="outline"
              size="sm"
              class="h-8 gap-2 text-xs text-muted-foreground px-2.5 hidden sm:flex cursor-pointer border-border/60 bg-muted/30 hover:bg-accent hover:text-accent-foreground shadow-2xs"
              @click="commandOpen = true"
            >
              <Search class="size-3.5" />
              <span>搜索导航...</span>
              <kbd
                class="pointer-events-none inline-flex h-4.5 select-none items-center gap-1 rounded bg-background border border-border/60 px-1.5 font-mono text-[10px] font-medium text-muted-foreground"
              >
                ⌘K
              </kbd>
            </Button>
          </AppTooltip>

          <AppTooltip :content="isDark ? '切换为浅色模式' : '切换为深色模式'">
            <Button variant="ghost" size="icon" class="size-8 cursor-pointer" @click="toggleDark">
              <Sun v-if="isDark" class="size-4" />
              <Moon v-else class="size-4" />
            </Button>
          </AppTooltip>

          <!-- 右上角账户下拉：服务商管理 + 退出 -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" class="h-8 gap-1.5 px-2.5 text-xs font-medium cursor-pointer">
                <UserRound class="size-3.5 text-muted-foreground" />
                <span class="hidden max-w-[7rem] truncate sm:inline">{{ session.username || '账户' }}</span>
                <ChevronDown class="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-48">
              <DropdownMenuLabel class="truncate">{{ session.username || '账户' }}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem as-child>
                <RouterLink to="/providers" class="w-full">服务商</RouterLink>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-destructive focus:text-destructive" @click="logout">
                <LogOut class="size-4" />
                退出
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>

    <!-- 全局快捷跳转对话框 (Command Palette) -->
    <CommandDialog v-model:open="commandOpen" :items="commandItems" />

    <!-- 默认密码安全提示弹窗 (Modal) -->
    <AppDialog v-model:open="securityAlertOpen" title="安全提示" content-class="sm:max-w-md">
      <div class="flex items-start gap-3 py-1">
        <div
          class="size-9 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0 mt-0.5"
        >
          <AlertTriangle class="size-5" />
        </div>
        <div class="space-y-2 text-sm">
          <div class="font-medium text-foreground">当前仍在使用默认初始密码</div>
          <p class="text-xs text-muted-foreground leading-relaxed">
            系统检测到当前账户密码仍为初始默认凭据
            <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground font-semibold">admin / admin</code>。
          </p>
          <p class="text-xs text-muted-foreground leading-relaxed">
            如已将面板部署至公网环境，为防止被未授权扫描和访问，请尽快在服务器
            <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">data/config.json</code>
            中修改密码并重启服务。
          </p>
        </div>
      </div>
      <template #footer>
        <Button class="w-full sm:w-auto" @click="closeSecurityAlert"> 我知道了 </Button>
      </template>
    </AppDialog>

    <main class="flex flex-1 flex-col">
      <div
        class="mx-auto w-full max-w-none min-w-0 flex-1 px-3 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10 md:w-[80vw] md:px-0 md:pb-12"
      >
        <RouterView v-slot="{ Component, route: currentRoute }">
          <Transition name="page-fade" mode="out-in">
            <component :is="Component" :key="currentRoute.fullPath" />
          </Transition>
        </RouterView>
      </div>
    </main>

    <!-- 页脚：版本号与项目链接 -->
    <footer class="mt-auto border-t border-border/40 py-4 text-xs text-muted-foreground">
      <div
        class="mx-auto flex h-6 w-full items-center justify-between px-3 sm:px-6 md:w-[80vw] md:px-0 whitespace-nowrap"
      >
        <div class="flex items-center gap-2 overflow-hidden text-ellipsis">
          <span class="font-semibold text-foreground/90">DNS-PRO</span>
          <Badge variant="outline" class="h-4.5 px-1.5 text-[10px] font-normal shrink-0 border-border/60"
            >v{{ session.version || '1.0.0' }}</Badge
          >
          <span class="hidden sm:inline text-muted-foreground/70">· 一体化 DNS 与隧道管理面板</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <AppTooltip content="GitHub 源码仓库">
            <a
              href="https://github.com/lei-rr/dns-pro"
              target="_blank"
              rel="noreferrer"
              class="p-1.5 rounded-md hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center cursor-pointer"
            >
              <svg class="size-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill-rule="evenodd"
                  clip-rule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
            </a>
          </AppTooltip>
        </div>
      </div>
    </footer>
  </div>
</template>
