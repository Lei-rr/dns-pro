<script setup lang="ts">
import { Plus, RefreshCw, Search } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button, LoadingButton } from '@/shared/ui/button'
import { TablePagination } from '@/shared/ui/pagination'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/shared/ui/field'
import PreferredDomainsDialog from '@/features/saas/ui/PreferredDomainsDialog.vue'
import FallbackOriginDialog from '@/features/saas/ui/FallbackOriginDialog.vue'
import SaasDetailDialog from '@/features/saas/ui/SaasDetailDialog.vue'
import HostnameFormDialog from '@/features/saas/ui/HostnameFormDialog.vue'
import SaasHostsTable from '@/features/saas/ui/SaasHostsTable.vue'
import { JobProgressAlert } from '@/shared/job'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useSaasHostsPanel, type SaasHostsPanelProps } from '../model/use-saas-hosts-panel'
import { encodePath } from '@/shared/lib/path'

const props = defineProps<SaasHostsPanelProps>()
const {
  router,
  jobProgress,
  saving,
  applyingPreferred,
  keyword,
  dialogOpen,
  detailOpen,
  detailLoading,
  detailRefreshing,
  rowBusyKeys,
  detailRecord,
  batchPreferredOpen,
  batchSubmitting,
  batchPreferredDomain,
  batchPreferredError,
  preferredOptions,
  editing,
  formErrors,
  form,
  syncZones,
  syncZonesError,
  preferredOptionsError,
  syncProviders,
  selectedCount,
  originSuggestions,
  showPreferred,
  showFallback,
  openPreferred,
  decodedZone,
  filtered,
  loading,
  refreshing,
  pageSize,
  onRefresh,
  page,
  total,
  pagedHostnames,
  selection,
  preferredDomainOf,
  onPageChange,
  onPageSizeChange,
  onSearch,
  openCreate,
  openEdit,
  openDetails,
  refreshDetailHostname,
  save,
  removeHostname,
  refreshHostname,
  repairHostnameDns,
  applyPreferred,
  batchDeleteSelected,
  openBatchPreferred,
  batchUpdatePreferred,
  loadSyncZones,
  loadPreferredOptions,
} = useSaasHostsPanel(props)
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader :title="decodedZone" description="Cloudflare SaaS 自定义主机名">
      <Button variant="outline" size="sm" @click="router.push('/' + encodePath(providerId))">返回站点</Button>
      <LoadingButton
        variant="outline"
        size="sm"
        :loading="refreshing"
        :disabled="loading && !refreshing"
        @click="onRefresh()"
      >
        <RefreshCw class="size-4" />
        刷新
      </LoadingButton>
      <Button variant="outline" size="sm" @click="showFallback = true">默认回源</Button>
      <Button variant="outline" size="sm" @click="openPreferred">优选域名</Button>
      <Button size="sm" @click="openCreate">
        <Plus class="size-4" />
        新增主机名
      </Button>
    </PageHeader>

    <JobProgressAlert
      :running="jobProgress.running.value || applyingPreferred"
      :text="jobProgress.text.value"
      title="SaaS 任务"
      :status="jobProgress.job.value?.status"
      :percent="jobProgress.percent.value"
    />

    <div class="flex w-full flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <Input v-model="keyword" class="h-8 w-full sm:w-72" placeholder="搜索主机名" @keyup.enter="onSearch" />
        <Button variant="outline" size="sm" @click="onSearch">
          <Search class="size-4" />
          搜索
        </Button>
        <template v-if="selectedCount && !jobProgress.running.value && !applyingPreferred">
          <span class="text-muted-foreground text-sm">已选 {{ selectedCount }}</span>
          <Button
            variant="outline"
            size="sm"
            :disabled="jobProgress.running.value || batchSubmitting"
            @click="openBatchPreferred"
          >
            批量改优选
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="text-destructive"
            :disabled="jobProgress.running.value"
            @click="batchDeleteSelected"
          >
            批量删除
          </Button>
        </template>
      </div>

      <SaasHostsTable
        :hostnames="pagedHostnames"
        :selected-hostnames="selection.selected.value"
        :loading="loading"
        :refreshing="refreshing"
        :busy-hostnames="[...rowBusyKeys]"
        :preferred-domain="preferredDomainOf"
        @update:selected-hostnames="selection.selected.value = $event"
        @detail="openDetails"
        @refresh="refreshHostname"
        @repair-dns="repairHostnameDns"
        @edit="openEdit"
        @remove="removeHostname"
      />

      <TablePagination
        :page="page"
        :page-size="pageSize"
        :total="total"
        :disabled="loading"
        @update:page="onPageChange"
        @update:page-size="onPageSizeChange"
      />
    </div>

    <HostnameFormDialog
      v-model:open="dialogOpen"
      v-model:form="form"
      :editing="!!editing"
      :saving="saving"
      :sync-providers="syncProviders"
      :sync-zones="syncZones"
      :preferred-options="preferredOptions"
      :origin-suggestions="originSuggestions"
      :errors="formErrors"
      :sync-zones-error="syncZonesError"
      :preferred-options-error="preferredOptionsError"
      @save="save"
      @retry-sync-zones="loadSyncZones"
      @retry-preferred-options="loadPreferredOptions"
    />

    <AppDialog
      v-model:open="batchPreferredOpen"
      title="批量修改优选域名"
      :description="`将把已选 ${selectedCount} 个主机名的优选域名改为：`"
    >
      <Field :data-invalid="!!batchPreferredError">
        <FieldLabel>优选域名</FieldLabel>
        <Select v-model="batchPreferredDomain">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="选择优选域名" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="item in preferredOptions" :key="item.domain" :value="item.domain">
              {{ item.domain }}
            </SelectItem>
          </SelectContent>
        </Select>
        <FieldError :errors="batchPreferredError ? [batchPreferredError] : []" />
      </Field>
      <template #footer>
        <Button variant="outline" @click="batchPreferredOpen = false">取消</Button>
        <Button @click="batchUpdatePreferred">开始修改</Button>
      </template>
    </AppDialog>

    <SaasDetailDialog
      v-model:open="detailOpen"
      :hostname="detailRecord"
      :loading="detailLoading"
      :refreshing="detailRefreshing"
      @edit="openEdit"
      @refresh="refreshDetailHostname"
    />
    <PreferredDomainsDialog
      v-model:open="showPreferred"
      :host-count="filtered.length"
      :applying="applyingPreferred || jobProgress.running.value"
      @apply="applyPreferred"
    />
    <FallbackOriginDialog v-model:open="showFallback" :provider-id="providerId" :zone-name="decodedZone" />
  </div>
</template>
