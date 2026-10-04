<script setup lang="ts">
import { computed, ref } from 'vue'
import { RefreshCw, Shield } from '@lucide/vue'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useProvidersQuery } from '@/features/providers'
import {
  AuditTrailPanel,
  SyncHealthTable,
  SyncSummaryCards,
  useAuditTrailQuery,
  useReconcileRepair,
  useSyncHealthQuery,
  type ReconcileScope,
  type SourceKind,
} from '@/features/sync'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'

const kindFilter = ref<'all' | SourceKind>('all')
const providerFilter = ref('all')

const { providers } = useProvidersQuery()
const scope = computed<ReconcileScope>(() => ({
  kind: kindFilter.value === 'all' ? undefined : kindFilter.value,
  providerId: providerFilter.value === 'all' ? undefined : providerFilter.value,
}))

const { items, summary, scannedAt, loading, refreshing, refresh } = useSyncHealthQuery(scope)
const { repair, repairing } = useReconcileRepair()
const { events, loading: auditLoading, refresh: refreshAudit } = useAuditTrailQuery()

const scannedText = computed(() => {
  if (!scannedAt.value) return '尚未检测'
  const date = new Date(scannedAt.value)
  return Number.isNaN(date.getTime()) ? scannedAt.value : `检测于 ${date.toLocaleTimeString()}`
})

/** 一键修复：只补齐/纠正 create、update；归属冲突的条目由写入器跳过 */
async function repairScope() {
  try {
    const result = await repair(scope.value)
    const changed = result.results.filter(
      (outcome) => outcome.status === 'created' || outcome.status === 'updated'
    ).length
    const skipped = result.results.filter((outcome) => outcome.status === 'skipped').length
    if (changed === 0 && skipped === 0) toast.success('派生记录均无需变更')
    else toast.success(`已修复 ${changed} 条${skipped ? `，跳过 ${skipped} 条（归属冲突）` : ''}`)
    await refresh()
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

async function refreshAll() {
  await Promise.all([refresh(), refreshAudit()])
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-6">
    <div class="flex flex-col gap-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
      <div class="min-w-0 space-y-0.5">
        <h1 class="text-2xl font-bold tracking-tight">同步健康</h1>
        <p class="text-muted-foreground text-sm">
          派生记录（SaaS 主机名 / 隧道路由 / EdgeOne 加速域名）与 DNS 实际解析的一致性；{{ scannedText }}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          class="gap-1.5 cursor-pointer"
          :disabled="loading || refreshing"
          @click="refreshAll"
        >
          <RefreshCw class="size-4" />
          重新检测
        </Button>
        <LoadingButton
          size="sm"
          class="gap-1.5 cursor-pointer shadow-xs"
          :loading="repairing"
          :disabled="loading"
          @click="repairScope"
        >
          <Shield class="size-4" />
          一键修复
        </LoadingButton>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Select v-model="kindFilter">
        <SelectTrigger class="h-9 w-44">
          <SelectValue placeholder="全部来源" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部来源</SelectItem>
          <SelectItem value="saas-hostname">SaaS 主机名</SelectItem>
          <SelectItem value="tunnel-route">隧道路由</SelectItem>
          <SelectItem value="edgeone-domain">EdgeOne 加速域名</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="providerFilter">
        <SelectTrigger class="h-9 w-52">
          <SelectValue placeholder="全部服务商" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部服务商</SelectItem>
          <SelectItem v-for="provider in providers" :key="provider.id" :value="provider.id">
            {{ provider.name || provider.id }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <SyncSummaryCards :summary="summary" />

    <SyncHealthTable :items="items" :loading="loading" :refreshing="refreshing" />

    <Card>
      <CardHeader>
        <CardTitle>操作审计</CardTitle>
        <CardDescription>批量操作、凭据变更与会话吊销的最近留痕（进程内存，重启即空）</CardDescription>
      </CardHeader>
      <CardContent>
        <AuditTrailPanel :events="events" :loading="auditLoading" />
      </CardContent>
    </Card>
  </div>
</template>
