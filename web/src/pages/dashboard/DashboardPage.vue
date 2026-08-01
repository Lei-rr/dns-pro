<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowRight, Cloud, Globe2, Radar, Server, Settings2, Shield } from '@lucide/vue'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
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
  <div class="flex flex-1 flex-col gap-5">
    <div class="flex flex-col gap-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold tracking-tight sm:text-2xl">控制台</h1>
        <p class="text-muted-foreground text-sm">已接入 {{ count }} 个服务商</p>
      </div>
      <RouterLink to="/providers">
        <Button size="sm" class="gap-1.5">
          <Settings2 class="size-4" />
          管理服务商
        </Button>
      </RouterLink>
    </div>

    <div v-if="count" class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div class="bg-muted/40 rounded-lg px-3 py-2">
        <div class="text-muted-foreground text-xs">服务商</div>
        <div class="text-lg font-semibold tabular-nums">{{ count }}</div>
      </div>
      <div class="bg-muted/40 rounded-lg px-3 py-2">
        <div class="text-muted-foreground text-xs">DNS</div>
        <div class="text-lg font-semibold tabular-nums">
          {{ providers.filter((p) => ['dnspod', 'cloudflare'].includes(p.type)).length }}
        </div>
      </div>
      <div class="bg-muted/40 rounded-lg px-3 py-2">
        <div class="text-muted-foreground text-xs">加速 / SaaS</div>
        <div class="text-lg font-semibold tabular-nums">
          {{ providers.filter((p) => ['saas', 'edgeone'].includes(p.type)).length }}
        </div>
      </div>
      <div class="bg-muted/40 rounded-lg px-3 py-2">
        <div class="text-muted-foreground text-xs">隧道</div>
        <div class="text-lg font-semibold tabular-nums">
          {{ providers.filter((p) => p.type === 'cloudflared').length }}
        </div>
      </div>
    </div>

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
          <Button size="sm" class="gap-1.5">
            <Settings2 class="size-4" />
            管理服务商
          </Button>
        </RouterLink>
      </EmptyContent>
    </Empty>

    <!-- 模块入口：略加大，仍保持横排 -->
    <div v-if="providers.length || providerStore.loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <RouterLink
        v-for="provider in providers"
        :key="provider.id"
        :to="providerPath(provider.id)"
        class="group hover:bg-muted/50 flex min-w-0 items-center gap-3 rounded-2xl px-3 py-3.5 transition-colors sm:gap-3.5 sm:px-4"
      >
        <div
          class="flex size-11 shrink-0 items-center justify-center rounded-xl text-white"
          :style="{ background: providerAvatarColor(provider.type) }"
        >
          <component :is="metaOf(provider.type).icon" class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate text-base font-medium">{{ provider.name }}</span>
            <Badge variant="secondary" class="h-5 shrink-0 px-1.5 text-[11px]">
              {{ providerTypeLabel(provider.type) }}
            </Badge>
          </div>
          <div class="text-muted-foreground mt-0.5 truncate text-sm">{{ metaOf(provider.type).blurb }}</div>
        </div>
        <ArrowRight
          class="text-muted-foreground size-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5"
        />
      </RouterLink>
    </div>
  </div>
</template>
