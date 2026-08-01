<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { ChevronDown, LogOut, Moon, UserRound } from '@lucide/vue'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { loadProviders, providerPath, useProviderStore } from '@/features/providers'
import { useSessionStore } from '@/features/auth'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { cn } from '@/shared/lib/utils'

const router = useRouter()
const route = useRoute()
const session = useSessionStore()
const providerStore = useProviderStore()

const providers = computed(() => providerStore.providers || [])
const activeProviderId = computed(() => {
  const first = route.path.split('/').filter(Boolean)[0] || ''
  if (!first || first === 'providers' || first === 'login') return ''
  return first
})

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

onMounted(async () => {
  try {
    await loadProviders()
  } catch (error) {
    toast.error(errorMessage(error))
  }
})

async function logout() {
  await session.logout()
  router.replace('/login')
}

function toggleDark() {
  document.documentElement.classList.toggle('dark')
}
</script>

<template>
  <div class="bg-background relative flex min-h-svh flex-col">
    <header class="bg-background sticky top-0 z-50 w-full">
      <!-- 手机全宽+内边距；桌面 ~80vw（用户：手机版不用 80%） -->
      <div
        class="mx-auto flex h-14 w-full max-w-none min-w-0 items-center gap-1.5 px-3 sm:h-16 sm:gap-2 sm:px-6 md:w-[80vw] md:px-0"
      >
        <RouterLink to="/" class="mr-1 flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight">
          <span
            class="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md text-sm font-bold"
          >
            D
          </span>
          <span class="hidden sm:inline">DNS-PRO</span>
        </RouterLink>

        <!-- 常驻：控制台 + 各服务商（非「服务商管理」入口） -->
        <nav class="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
          <Button variant="ghost" as-child size="sm" class="h-9 shrink-0 px-3 text-[15px]">
            <RouterLink to="/" :class="cn(isActivePath('/') && 'bg-accent text-accent-foreground')">
              控制台
            </RouterLink>
          </Button>
          <Button
            v-for="item in providers"
            :key="item.id"
            variant="ghost"
            as-child
            size="sm"
            class="h-9 shrink-0 px-3 text-[15px]"
          >
            <RouterLink
              :to="providerPath(item.id)"
              :class="cn(activeProviderId === item.id && 'bg-accent text-accent-foreground')"
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

        <div class="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" class="size-9" title="主题" @click="toggleDark">
            <Moon class="size-4" />
          </Button>

          <!-- 右上角账户下拉：服务商管理 + 退出 -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" class="h-9 gap-1.5 px-3 text-[15px]">
                <UserRound class="size-4" />
                <span class="hidden max-w-[7rem] truncate sm:inline">{{ session.username || '账户' }}</span>
                <ChevronDown class="size-4 opacity-60" />
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
  </div>
</template>
