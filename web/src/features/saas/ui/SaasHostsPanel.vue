<script setup lang="ts">
import { Plus, RefreshCw, Search, X } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { FloatingSelectionBar } from '@/shared/ui/floating-selection-bar'
import { TablePagination } from '@/shared/ui/pagination'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/shared/ui/field'
import { Switch } from '@/shared/ui/switch'
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
// 面板级上下文（router/routeZoneName）留在顶层，其余按职责分组；组内 ref 一律显式 .value
const { router, routeZoneName, list, rows, detail, editor, batch } = useSaasHostsPanel(props)

function clearSearch() {
  list.keyword.value = ''
  list.onSearch()
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader :title="routeZoneName" description="Cloudflare SaaS 自定义主机名">
      <Button variant="outline" size="sm" @click="router.push('/' + encodePath(providerId))">返回站点</Button>
      <LoadingButton
        variant="outline"
        size="sm"
        :loading="list.refreshing.value"
        :disabled="list.loading.value && !list.refreshing.value"
        @click="list.onRefresh()"
      >
        <RefreshCw class="size-4" />
        刷新
      </LoadingButton>
      <Button variant="outline" size="sm" @click="batch.showFallback.value = true">默认回源</Button>
      <Button variant="outline" size="sm" @click="batch.openPreferred">优选域名</Button>
      <Button size="sm" @click="editor.openCreate">
        <Plus class="size-4" />
        新增主机名
      </Button>
    </PageHeader>

    <JobProgressAlert
      :running="batch.jobProgress.running.value"
      :text="batch.jobProgress.text.value"
      title="SaaS 任务"
      :status="batch.jobProgress.job.value?.status"
      :percent="batch.jobProgress.percent.value"
    />

    <div class="flex w-full flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative w-full sm:w-72">
          <Input
            v-model="list.keyword.value"
            class="h-8 w-full pr-7"
            placeholder="搜索主机名"
            @keyup.enter="list.onSearch"
          />
          <button
            v-if="list.keyword.value"
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            title="清空"
            @click="clearSearch"
          >
            <X class="size-3.5" />
          </button>
        </div>
        <Button variant="outline" size="sm" @click="list.onSearch">
          <Search class="size-4" />
          搜索
        </Button>
        <span
          v-if="batch.selectedCount.value && !batch.jobProgress.running.value && !batch.applyingPreferred.value"
          class="text-muted-foreground text-sm"
        >
          已选 {{ batch.selectedCount.value }}
        </span>
      </div>

      <SaasHostsTable
        :hostnames="list.pagedHostnames.value"
        :selected-hostnames="batch.selection.selected.value"
        :loading="list.loading.value"
        :refreshing="list.refreshing.value"
        :busy-hostnames="[...rows.rowBusyKeys.value]"
        :preferred-domain="batch.preferredDomainOf"
        @update:selected-hostnames="batch.selection.selected.value = $event"
        @detail="detail.openDetails"
        @refresh="rows.refreshHostname"
        @repair-dns="rows.repairHostnameDns"
        @edit="editor.openEdit"
        @remove="rows.removeHostname"
      />

      <TablePagination
        :page="list.page.value"
        :page-size="list.pageSize.value"
        :total="list.total.value"
        :disabled="list.loading.value"
        @update:page="list.onPageChange"
        @update:page-size="list.onPageSizeChange"
      />
    </div>

    <!-- 勾选后：底部悬浮操作条 -->
    <FloatingSelectionBar
      :show="batch.selectedCount.value > 0 && !batch.jobProgress.running.value && !batch.applyingPreferred.value"
      :count="batch.selectedCount.value"
      :disabled="batch.jobProgress.running.value || batch.batchSubmitting.value || batch.applyingPreferred.value"
      @clear="batch.selection.clear()"
    >
      <Button
        size="sm"
        class="h-7 px-3 text-xs cursor-pointer"
        :disabled="batch.jobProgress.running.value || batch.batchSubmitting.value || batch.applyingPreferred.value"
        @click="batch.openBatchPreferred"
      >
        批量改优选
      </Button>
      <Button
        size="sm"
        variant="destructive"
        class="h-7 px-3 text-xs cursor-pointer"
        :disabled="batch.jobProgress.running.value || batch.batchSubmitting.value || batch.applyingPreferred.value"
        @click="batch.batchDeleteSelected"
      >
        批量删除
      </Button>
    </FloatingSelectionBar>

    <HostnameFormDialog
      v-model:open="editor.dialogOpen.value"
      v-model:form="editor.form"
      :editing="!!editor.editing.value"
      :saving="editor.saving.value"
      :sync-providers="editor.syncProviders.value"
      :sync-zones="editor.syncZones.value"
      :preferred-options="editor.preferredOptions.value"
      :origin-suggestions="editor.originSuggestions.value"
      :errors="editor.formErrors.value"
      :sync-zones-error="editor.syncZonesError.value"
      :preferred-options-error="editor.preferredOptionsError.value"
      @save="editor.save"
      @retry-sync-zones="editor.loadSyncZones"
      @retry-preferred-options="editor.loadPreferredOptions"
    />

    <AppDialog
      v-model:open="batch.batchPreferredOpen.value"
      title="批量修改优选域名"
      :description="`将把已选 ${batch.selectedCount.value} 个主机名的优选域名改为：`"
    >
      <Field :data-invalid="!!batch.batchPreferredError.value">
        <FieldLabel>优选域名</FieldLabel>
        <Select v-model="batch.batchPreferredDomain.value">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="选择优选域名" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="item in editor.preferredOptions.value" :key="item.domain" :value="item.domain">
              {{ item.domain }}
            </SelectItem>
          </SelectContent>
        </Select>
        <FieldError :errors="batch.batchPreferredError.value ? [batch.batchPreferredError.value] : []" />
      </Field>
      <Field orientation="horizontal">
        <Switch v-model="batch.batchAutoPreferred.value" />
        <FieldLabel>同时开启自动优选</FieldLabel>
      </Field>
      <template #footer>
        <Button variant="outline" @click="batch.batchPreferredOpen.value = false">取消</Button>
        <Button @click="batch.batchUpdatePreferred">开始修改</Button>
      </template>
    </AppDialog>

    <SaasDetailDialog
      v-model:open="detail.detailOpen.value"
      :hostname="detail.detailRecord.value"
      :loading="detail.detailLoading.value"
      :refreshing="detail.detailRefreshing.value"
      @edit="editor.openEdit"
      @refresh="detail.refreshDetailHostname"
    />
    <PreferredDomainsDialog
      v-model:open="batch.showPreferred.value"
      :host-count="list.hostTotal.value"
      :applying="batch.applyingPreferred.value || batch.jobProgress.running.value"
      @apply="batch.applyPreferred"
    />
    <FallbackOriginDialog
      v-model:open="batch.showFallback.value"
      :provider-id="providerId"
      :zone-name="routeZoneName"
    />
  </div>
</template>
