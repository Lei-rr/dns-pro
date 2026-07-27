<script setup lang="ts">
import { computed } from 'vue'
import { AppDialog } from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import type { SaaSHostname, SaaSHostnameSSL } from '@/shared/types'
import { formatDate, minTlsLabel, statusLabel, statusVariant } from '@/features/saas/lib/status'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    hostname?: SaaSHostname | null
    loading?: boolean
    refreshing?: boolean
  }>(),
  {
    hostname: null,
    loading: false,
    refreshing: false,
  },
)

const emit = defineEmits<{
  edit: [hostname: SaaSHostname]
  refresh: [hostname: SaaSHostname]
}>()

const record = computed(() => props.hostname || ({} as SaaSHostname))
const ssl = computed(() => (record.value.ssl || {}) as SaaSHostnameSSL)
const sslSettings = computed(() => (ssl.value.settings || {}) as Record<string, unknown>)
const ownership = computed(() => record.value.ownership_verification || {})

const needsDcvHelp = computed(() => {
  const status = String(ssl.value.status || '')
  const finalStates = ['active', 'deleted', 'deactivated', 'pending_deletion']
  return !!status && !finalStates.includes(status)
})

const needsOwnershipHelp = computed(() => {
  const status = String(record.value.status || '')
  const finalStates = ['active', 'active_renewing', 'moved', 'deleted', 'blocked', 'pending_deletion']
  return !!status && !finalStates.includes(status)
})

const errorMessages = computed(() => {
  const out: string[] = []
  const pushAll = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const e of list) {
      if (typeof e === 'string') out.push(e)
      else if (e && typeof e === 'object') {
        const row = e as { message?: string; error?: string }
        out.push(row.message || row.error || JSON.stringify(e))
      }
    }
  }
  pushAll(record.value.verification_errors)
  pushAll(ssl.value.validation_errors)
  return out
})

const dcvDelegationRecords = computed(() => {
  if (!needsDcvHelp.value) return [] as Array<{ cname: string; cname_target: string }>
  const records = (ssl.value.dcv_delegation_records || []) as Array<{ cname: string; cname_target: string }>
  if (Array.isArray(records) && records.length > 0) return records
  const uuid = String(ssl.value.dcv_delegation_uuid || '').trim()
  const fqdn = String(record.value.hostname || '').trim()
  if (uuid && fqdn) {
    return [
      {
        cname: `_acme-challenge.${fqdn}`,
        cname_target: `${fqdn}.${uuid}.dcv.cloudflare.com`,
      },
    ]
  }
  return []
})

const acmeTempRecords = computed(() => {
  if (!needsDcvHelp.value) return [] as Array<{ type: string; name: string; value: string }>
  const records = ssl.value.validation_records || []
  if (!Array.isArray(records)) return []
  return records
    .map((r) => {
      if (r.txt_name && r.txt_value) return { type: 'TXT', name: r.txt_name, value: r.txt_value }
      if (r.http_url && r.http_body) return { type: 'HTTP', name: r.http_url, value: r.http_body }
      return null
    })
    .filter((item): item is { type: string; name: string; value: string } => !!item)
})

function onEdit() {
  if (!props.hostname) return
  open.value = false
  emit('edit', props.hostname)
}

function onRefresh() {
  if (!props.hostname) return
  emit('refresh', props.hostname)
}
</script>

<template>
  <AppDialog
    v-model:open="open"
    title="自定义主机名详情"
    description="查看状态、证书与验证记录。"
    content-class="sm:max-w-2xl"
  >
    <div v-if="loading && !hostname" class="text-muted-foreground py-8 text-center text-sm">加载中…</div>
    <div v-else-if="hostname" class="space-y-4" :class="loading && 'opacity-60'">
      <div
        v-if="errorMessages.length"
        class="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
      >
        <ul class="list-disc space-y-1 pl-4">
          <li v-for="(msg, i) in errorMessages" :key="i">{{ msg }}</li>
        </ul>
      </div>

      <div class="rounded-md border">
        <div class="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 p-3 text-sm">
          <div class="text-muted-foreground">主机名</div>
          <div class="min-w-0 break-all font-medium">{{ record.hostname || '-' }}</div>

          <div class="text-muted-foreground">主机名状态</div>
          <div>
            <Badge :variant="statusVariant(record.status)">{{ statusLabel(record.status) }}</Badge>
          </div>

          <div class="text-muted-foreground">回源服务器</div>
          <div class="min-w-0 break-all">{{ record.custom_origin_server || '默认回源' }}</div>

          <div class="text-muted-foreground">最低 TLS</div>
          <div>{{ minTlsLabel(String(sslSettings.min_tls_version || '')) }}</div>

          <div class="text-muted-foreground">证书颁发</div>
          <div class="min-w-0 break-all">{{ ssl.issuer || '—' }}</div>

          <div class="text-muted-foreground">证书到期</div>
          <div>{{ formatDate(ssl.expires_on) }}</div>

          <div class="text-muted-foreground">证书状态</div>
          <div>
            <Badge :variant="statusVariant(ssl.status)">{{ statusLabel(ssl.status) }}</Badge>
          </div>
        </div>
      </div>

      <div
        v-if="needsOwnershipHelp && ownership.name"
        class="rounded-md border"
      >
        <div class="bg-muted/40 border-b px-3 py-2 text-sm font-medium">域名所有权验证（TXT）</div>
        <div class="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 p-3 text-sm">
          <div class="text-muted-foreground">记录名</div>
          <div class="min-w-0 break-all">{{ ownership.name }}</div>
          <div class="text-muted-foreground">记录值</div>
          <div class="min-w-0 break-all">{{ ownership.value || '-' }}</div>
        </div>
      </div>

      <div
        v-for="(rec, index) in dcvDelegationRecords"
        :key="`dcv-${index}`"
        class="rounded-md border"
      >
        <div class="bg-muted/40 border-b px-3 py-2 text-sm font-medium">DCV 委派（CNAME）</div>
        <div class="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 p-3 text-sm">
          <div class="text-muted-foreground">记录名</div>
          <div class="min-w-0 break-all">{{ rec.cname }}</div>
          <div class="text-muted-foreground">记录值</div>
          <div class="min-w-0 break-all">{{ rec.cname_target }}</div>
        </div>
      </div>

      <details v-if="acmeTempRecords.length" class="rounded-md border">
        <summary class="text-muted-foreground cursor-pointer px-3 py-2 text-sm">
          临时 ACME 验证（{{ acmeTempRecords.length }} 条；添加 DCV 后通常可忽略）
        </summary>
        <div class="space-y-3 border-t p-3">
          <div
            v-for="(rec, index) in acmeTempRecords"
            :key="`acme-${index}`"
            class="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-sm"
          >
            <div class="text-muted-foreground">类型</div>
            <div>{{ rec.type }}</div>
            <div class="text-muted-foreground">记录名</div>
            <div class="min-w-0 break-all">{{ rec.name }}</div>
            <div class="text-muted-foreground">记录值</div>
            <div class="min-w-0 break-all">{{ rec.value }}</div>
          </div>
        </div>
      </details>
    </div>

    <template #footer>
      <Button variant="outline" @click="open = false">关闭</Button>
      <Button variant="outline" :disabled="!hostname" @click="onEdit">编辑</Button>
      <Button :loading="refreshing" :disabled="!hostname" @click="onRefresh">刷新状态</Button>
    </template>
  </AppDialog>
</template>
