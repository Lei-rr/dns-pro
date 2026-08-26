<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowRight, Cloud, Globe2, Radar, Server, Settings2, Shield } from '@lucide/vue'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Card } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/shared/ui/empty'
import {
  loadProviders,
  providerAvatarColor,
  providerPath,
  providerTypeLabel,
  useProviderStore,
} from '@/features/providers'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import type { Component } from 'vue'

const providerStore = useProviderStore()
const providers = computed(() => providerStore.providers || [])
const count = computed(() => providers.value.length)

const typeMeta: Record<string, { blurb: string; icon: Component }> = {
  dnspod: { blurb: '域名与解析', icon: Globe2 },
  cloudflare: { blurb: 'Zones / DNS', icon: Cloud },
  saas: { blurb: '主机名 / 优选', icon: Shield },
  edgeone: { blurb: '加速 / 证书', icon: Radar },
  cloudflared: { blurb: '隧道 / 路由', icon: Server },
}

function metaOf(type: string) {
  return typeMeta[type] || { blurb: '进入管理', icon: Globe2 }
}

onMounted(async () => {
  try {
    await loadProviders()
  } catch (error) {
    toast.error(errorMessage(error))
  }
})
</script>

<template>
  <div class="flex flex-1 flex-col gap-6">
    <div class="flex flex-col gap-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
      <div class="min-w-0 space-y-0.5">
        <h1 class="text-xl font-bold tracking-tight sm:text-2xl">控制台</h1>
        <p class="text-muted-foreground text-sm">
          <template v-if="providerStore.loading">正在加载服务商数据...</template>
          <template v-else>已接入 {{ count }} 个服务商</template>
        </p>
      </div>
      <RouterLink to="/providers">
        <Button size="sm" class="gap-1.5 shadow-xs">
          <Settings2 class="size-4" />
          管理服务商
        </Button>
      </RouterLink>
    </div>

    <!-- 骨架屏：统计卡片 -->
    <div v-if="providerStore.loading" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card v-for="i in 4" :key="i" class="gap-1.5 p-4 shadow-xs">
        <Skeleton class="h-3 w-14" />
        <Skeleton class="h-7 w-10" />
      </Card>
    </div>

    <!-- 真实数据：统计卡片 -->
    <div v-else-if="count" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card class="gap-1 p-4 shadow-xs">
        <div class="text-xs font-medium text-muted-foreground">服务商总数</div>
        <div class="text-2xl font-bold tracking-tight tabular-nums">{{ count }}</div>
      </Card>
      <Card class="gap-1 p-4 shadow-xs">
        <div class="text-xs font-medium text-muted-foreground">DNS 托管</div>
        <div class="text-2xl font-bold tracking-tight tabular-nums">
          {{ providers.filter((p) => ['dnspod', 'cloudflare'].includes(p.type)).length }}
        </div>
      </Card>
      <Card class="gap-1 p-4 shadow-xs">
        <div class="text-xs font-medium text-muted-foreground">SaaS / 加速</div>
        <div class="text-2xl font-bold tracking-tight tabular-nums">
          {{ providers.filter((p) => ['saas', 'edgeone'].includes(p.type)).length }}
        </div>
      </Card>
      <Card class="gap-1 p-4 shadow-xs">
        <div class="text-xs font-medium text-muted-foreground">Cloudflare 隧道</div>
        <div class="text-2xl font-bold tracking-tight tabular-nums">
          {{ providers.filter((p) => p.type === 'cloudflared').length }}
        </div>
      </Card>
    </div>

    <!-- 空状态 -->
    <Empty v-if="!providers.length && !providerStore.loading">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Globe2 />
        </EmptyMedia>
        <EmptyTitle>还没有服务商</EmptyTitle>
        <EmptyDescription>先添加 DNSPod / Cloudflare / EdgeOne / Tunnel</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <RouterLink to="/providers">
          <Button size="sm" class="gap-1.5 shadow-xs">
            <Settings2 class="size-4" />
            管理服务商
          </Button>
        </RouterLink>
      </EmptyContent>
    </Empty>

    <!-- 骨架屏：服务商卡片列表 -->
    <div v-if="providerStore.loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Card v-for="i in 3" :key="i" class="h-full flex-row items-center gap-3.5 p-4 shadow-xs">
        <Skeleton class="size-11 rounded-lg shrink-0" />
        <div class="min-w-0 flex-1 space-y-2">
          <div class="flex items-center gap-2">
            <Skeleton class="h-4 w-24" />
            <Skeleton class="h-4 w-12" />
          </div>
          <Skeleton class="h-3 w-32" />
        </div>
      </Card>
    </div>

    <!-- 真实数据：服务商卡片列表 -->
    <div v-else-if="providers.length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <RouterLink v-for="provider in providers" :key="provider.id" :to="providerPath(provider.id)" class="group">
        <Card
          class="h-full flex-row items-center gap-3.5 p-4 transition-all hover:border-primary/40 hover:bg-accent/40 shadow-xs cursor-pointer"
        >
          <div
            class="flex size-11 shrink-0 items-center justify-center rounded-lg text-white shadow-xs"
            :style="{ background: providerAvatarColor(provider.type) }"
          >
            <component :is="metaOf(provider.type).icon" class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-base font-semibold tracking-tight">{{ provider.name }}</span>
              <Badge variant="secondary" class="h-5 shrink-0 px-1.5 text-[11px] font-normal">
                {{ providerTypeLabel(provider.type) }}
              </Badge>
            </div>
            <div class="text-muted-foreground mt-0.5 truncate text-xs">{{ metaOf(provider.type).blurb }}</div>
          </div>
          <ArrowRight
            class="text-muted-foreground size-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100"
          />
        </Card>
      </RouterLink>
    </div>
  </div>
</template>
