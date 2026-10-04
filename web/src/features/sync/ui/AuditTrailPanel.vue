<script setup lang="ts">
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty'
import { StatusBadge } from '@/shared/ui/status-badge'
import { AUDIT_LABEL } from '../lib/status'
import type { AuditEvent } from '../model/types'

defineProps<{
  events: AuditEvent[]
  loading?: boolean
}>()

function badgeVariant(action: string) {
  if (action === 'credential_change') return 'warning' as const
  if (action === 'session_revoked') return 'destructive' as const
  return 'secondary' as const
}

function detailText(detail: Record<string, unknown>) {
  return Object.entries(detail)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' · ')
}

function timeText(at: string) {
  if (!at) return '—'
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString()
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <Empty v-if="!events.length && !loading">
      <EmptyHeader>
        <EmptyTitle>暂无审计记录</EmptyTitle>
        <EmptyDescription>批量操作、凭据变更与会话吊销会在这里留痕</EmptyDescription>
      </EmptyHeader>
    </Empty>

    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="event in events"
        :key="event.id"
        class="flex flex-col gap-1 rounded-lg border border-border/40 px-3 py-2"
      >
        <div class="flex flex-wrap items-center gap-2">
          <StatusBadge :variant="badgeVariant(event.action)">{{
            AUDIT_LABEL[event.action] ?? event.action
          }}</StatusBadge>
          <span class="truncate text-sm font-medium">{{ event.target }}</span>
          <span class="text-muted-foreground ml-auto text-xs tabular-nums">{{ timeText(event.at) }}</span>
        </div>
        <div class="text-muted-foreground truncate text-xs">
          {{ event.actor || '未知操作者'
          }}<template v-if="detailText(event.detail)"> · {{ detailText(event.detail) }}</template>
        </div>
      </li>
    </ul>
  </div>
</template>
