<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Search, CornerDownLeft } from '@lucide/vue'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Badge } from '@/shared/ui/badge'
import { cn } from '@/shared/lib/utils'
import type { Component } from 'vue'

export interface CommandItem {
  id: string
  title: string
  subtitle?: string
  category: string
  icon: Component
  badge?: string
  action: () => void
}

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  items: CommandItem[]
  placeholder?: string
}>()

const query = ref('')
const selectedIndex = ref(0)
const listContainerRef = ref<HTMLElement | null>(null)

const filteredItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.items
  return props.items.filter((item) =>
    [item.title, item.subtitle, item.category, item.badge].some((text) =>
      String(text || '')
        .toLowerCase()
        .includes(q)
    )
  )
})

// Group items by category preserving insertion order
const groupedCategories = computed(() => {
  const groups: Array<{ category: string; items: Array<{ item: CommandItem; globalIndex: number }> }> = []
  const map = new Map<string, Array<{ item: CommandItem; globalIndex: number }>>()

  filteredItems.value.forEach((item, globalIndex) => {
    const cat = item.category || '通用'
    if (!map.has(cat)) {
      const arr: Array<{ item: CommandItem; globalIndex: number }> = []
      map.set(cat, arr)
      groups.push({ category: cat, items: arr })
    }
    map.get(cat)!.push({ item, globalIndex })
  })

  return groups
})

watch(open, (isOpen) => {
  if (isOpen) {
    query.value = ''
    selectedIndex.value = 0
  }
})

watch(filteredItems, () => {
  if (selectedIndex.value >= filteredItems.value.length) {
    selectedIndex.value = Math.max(0, filteredItems.value.length - 1)
  }
})

function executeSelected() {
  const item = filteredItems.value[selectedIndex.value]
  if (item) {
    item.action()
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!filteredItems.value.length) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % filteredItems.value.length
    scrollToActive()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + filteredItems.value.length) % filteredItems.value.length
    scrollToActive()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    executeSelected()
  }
}

function scrollToActive() {
  nextTick(() => {
    if (!listContainerRef.value) return
    const activeEl = listContainerRef.value.querySelector<HTMLElement>('[data-active="true"]')
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' })
    }
  })
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :show-close-button="false"
      class="sm:max-w-xl p-0 gap-0 overflow-hidden border border-border bg-background shadow-2xl rounded-xl"
      @keydown="handleKeydown"
    >
      <!-- Search Input Header -->
      <div class="flex items-center border-b border-border px-3.5 h-12 gap-2.5">
        <Search class="size-4 text-muted-foreground shrink-0" />
        <input
          v-model="query"
          type="text"
          autofocus
          :placeholder="placeholder || '输入服务商、页面或命令...'"
          class="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none min-w-0"
        />
        <kbd
          class="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground select-none"
        >
          ESC
        </kbd>
      </div>

      <!-- Results List with Group Headers -->
      <div ref="listContainerRef" class="max-h-[340px] overflow-y-auto p-2 space-y-3 select-none">
        <div v-if="!filteredItems.length" class="py-10 text-center text-xs text-muted-foreground">
          未找到匹配的页面、服务商或命令
        </div>

        <div v-for="group in groupedCategories" :key="group.category" class="space-y-1">
          <div class="px-2 pt-1 pb-0.5 text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">
            {{ group.category }}
          </div>

          <div
            v-for="{ item, globalIndex } in group.items"
            :key="item.id"
            :data-active="selectedIndex === globalIndex"
            :class="
              cn(
                'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer text-sm',
                selectedIndex === globalIndex
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-foreground/90 hover:bg-accent/60'
              )
            "
            @click="item.action()"
            @mouseenter="selectedIndex = globalIndex"
          >
            <div
              :class="
                cn(
                  'size-7 rounded-md flex items-center justify-center shrink-0 transition-colors',
                  selectedIndex === globalIndex ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground/70'
                )
              "
            >
              <component :is="item.icon" class="size-3.5" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="truncate">{{ item.title }}</span>
                <Badge v-if="item.badge" variant="secondary" class="text-[10px] h-4 px-1 shrink-0 font-normal">
                  {{ item.badge }}
                </Badge>
              </div>
              <div v-if="item.subtitle" class="text-xs text-muted-foreground truncate font-normal">
                {{ item.subtitle }}
              </div>
            </div>
            <CornerDownLeft
              v-if="selectedIndex === globalIndex"
              class="size-3.5 text-muted-foreground shrink-0 opacity-70"
            />
          </div>
        </div>
      </div>

      <!-- Footer Guide -->
      <div
        class="flex items-center justify-between border-t border-border bg-muted/30 px-3.5 py-2 text-[11px] text-muted-foreground"
      >
        <div class="flex items-center gap-3">
          <span class="flex items-center gap-1">
            <kbd class="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">↑</kbd>
            <kbd class="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">↓</kbd>
            切换
          </span>
          <span class="flex items-center gap-1">
            <kbd class="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">↵</kbd>
            选择
          </span>
        </div>
        <div>共 {{ filteredItems.length }} 项结果</div>
      </div>
    </DialogContent>
  </Dialog>
</template>
