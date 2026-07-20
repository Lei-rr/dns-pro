<template>
  <section>
    <ListToolbar
      back-text="返回站点"
      :title="decodedZoneName"
      subtitle="Cloudflare for SaaS 自定义主机名列表"
      @back="router.push(zonesPath)"
    >
      <template #actions>
        <a-button
          :loading="loading || applyingPreferred"
          :disabled="creating || savingEdit || deleting || applyingPreferred"
          @click="handleRefresh"
          >刷新</a-button
        >
        <a-button
          :disabled="notFound || creating || savingEdit || deleting || applyingPreferred"
          @click="openFallbackOrigin"
          >默认回源</a-button
        >
        <a-button
          v-if="dnspodLinked"
          :disabled="creating || savingEdit || deleting || applyingPreferred"
          @click="openPreferredManager"
          >优选域名</a-button
        >
        <a-button
          type="primary"
          :disabled="notFound || creating || savingEdit || deleting || applyingPreferred"
          @click="openCreate"
          >新增主机名</a-button
        >
      </template>
    </ListToolbar>
    <JobProgressAlert
      :running="applyingPreferred"
      :text="applyingPreferredText"
      title="正在一键切换优选域名..."
      tone="info"
    />
    <JobProgressAlert :running="deleting" :text="deletingText" />
    <BatchToolbar
      :count="selectedHostnames.length"
      :deleting="deleting || applyingPreferred"
      delete-text="批量删除"
      :actions="batchActions"
      @delete="askBatchDelete"
      @action="onBatchAction"
      @clear="clearSelection"
    />
    <a-result v-if="notFound" status="404" title="站点不存在或不可访问" :sub-title="decodedZoneName">
      <template #extra><a-button type="primary" @click="router.push(zonesPath)">返回站点</a-button></template>
    </a-result>

    <a-table
      v-else
      :columns="columns"
      :data-source="hostnames"
      :row-key="hostnameRowKey"
      :loading="loading"
      :pagination="pagination"
      :row-selection="{
        selectedRowKeys: selectedHostnames.map((item) => item.id || item.hostname),
        onChange: selectHostnames,
      }"
      size="middle"
      :scroll="{ x: 1000 }"
      :locale="{ emptyText: '暂无自定义主机名' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'hostname'">
          <a-space style="max-width: 100%">
            <a-avatar size="small" :style="{ background: hostnameAvatarColor() }">{{
              hostnameAvatar(record.hostname)
            }}</a-avatar>
            <a class="table-link-ellipsis" :title="record.hostname" @click="openDetails(record)">{{
              record.hostname
            }}</a>
          </a-space>
        </template>
        <template v-else-if="column.key === 'ssl_status'">
          <a-tag :color="statusColor(record.ssl?.status)">{{ statusLabel(record.ssl?.status) }}</a-tag>
        </template>
        <template v-else-if="column.key === 'expires_on'">
          {{ formatDate(record.ssl?.expires_on) }}
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
        </template>
        <template v-else-if="column.key === 'custom_origin_server'">
          <a-space size="small">
            <a-tag v-if="!record.custom_origin_server" color="blue">默认回源</a-tag>
            <a-typography-text
              v-else
              :ellipsis="{ tooltip: record.custom_origin_server }"
              style="max-width: 140px"
            >
              {{ record.custom_origin_server }}
            </a-typography-text>
          </a-space>
        </template>
        <template v-else-if="column.key === 'preferred_domain'">
          <a-space size="small">
            <a-typography-text type="secondary" v-if="!preferredDomainOf(record)">—</a-typography-text>
            <a-typography-text
              v-else
              :ellipsis="{ tooltip: preferredDomainOf(record) }"
              style="max-width: 160px"
            >
              {{ preferredDomainOf(record) }}
            </a-typography-text>
          </a-space>
        </template>
        <template v-else-if="column.key === 'actions'">
          <TableActions
            :disabled="creating || savingEdit || deleting"
            :show-edit="false"
            :primary="{ key: 'detail', label: '详情' }"
            :items="[
              { key: 'edit', label: '编辑', inline: true },
              { key: 'delete', label: '删除', danger: true, inline: true },
            ]"
            @select="(key) => onHostnameAction(key, record)"
          />
        </template>
      </template>
    </a-table>

    <SaasCreateModal
      :open="showCreateForm"
      :title="editingHostname ? '编辑自定义主机名' : '新增自定义主机名'"
      :ok-text="editingHostname ? '保存' : '创建'"
      :confirm-loading="editingHostname ? savingEdit : creating"
      :dnspod-linked="dnspodLinked"
      :cloudflare-dns-linked="cloudflareDnsLinked"
      :dnspod-providers="dnspodProviders"
      :cloudflare-dns-providers="cloudflareProviders"
      :dnspod-zones="dnspodZones"
      :cloudflare-dns-zones="cloudflareDnsZones"
      :origin-suggestions="originSuggestions"
      :preferred-domains="preferredDomains"
      :initial-value="editingHostname"
      :editing="!!editingHostname"
      @update:open="
        (value) => {
          showCreateForm = value
          if (!value) editingHostname = null
        }
      "
      @submit="editingHostname ? update($event) : create($event)"
    />
    <SaasDetailModal
      :open="showDetails"
      :hostname="selectedHostname"
      :loading="detailLoading"
      :refreshing="refreshing[selectedHostname?.id || ''] || false"
      @update:open="handleDetailsOpenChange"
      @edit="openEdit"
      @refresh="refreshHostname"
    />
    <PreferredDomainsModal
      v-model:open="showPreferredManager"
      :host-count="hostnames.length"
      :applying="applyingPreferred"
      @update="onPreferredUpdate"
      @apply="applyPreferredDomainToList"
    />
    <SaasFallbackOriginModal
      v-model:open="showFallbackOrigin"
      :provider="provider"
      :zone-name="decodedZoneName"
      @updated="onFallbackUpdated"
    />
  </section>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { statusColor, statusLabel, formatDate } from '../utils/saas'
import ListToolbar from '@/shared/components/ListToolbar.vue'
import JobProgressAlert from '@/shared/components/JobProgressAlert.vue'
import BatchToolbar from '@/shared/components/BatchToolbar.vue'
import TableActions from '@/shared/components/TableActions.vue'
import SaasCreateModal from '../components/SaasCreateModal.vue'
import SaasDetailModal from '../components/SaasDetailModal.vue'
import SaasFallbackOriginModal from '../components/SaasFallbackOriginModal.vue'
import PreferredDomainsModal from '../components/PreferredDomainsModal.vue'
import { useSaasHostnames } from '../composables/useSaasHostnames'
import { usePreferredDomains } from '../composables/usePreferredDomains'
import { useSaasHostnameSelection } from '../composables/useSaasHostnameSelection'
import { useSaasHostnameModals } from '../composables/useSaasHostnameModals'
import { useSaasHostnameCrud } from '../composables/useSaasHostnameCrud'
import type { SaaSHostname } from '@/types'

const props = defineProps<{
  provider: string
  zoneName: string
}>()

const router = useRouter()
const selectedHostname = ref<SaaSHostname | null>(null)

const hostnamesApi = useSaasHostnames(props, selectedHostname)
const preferred = usePreferredDomains()
const selection = useSaasHostnameSelection()
const modals = useSaasHostnameModals({ selectedHostname, load: hostnamesApi.load })
const crud = useSaasHostnameCrud({
  props,
  hostnames: hostnamesApi.hostnames,
  selectedHostnames: selection.selectedHostnames,
  selectedHostname,
  showDetails: modals.showDetails,
  editingHostname: modals.editingHostname,
  showCreateForm: modals.showCreateForm,
  decodedZoneName: hostnamesApi.decodedZoneName,
  load: hostnamesApi.load,
  clearSelection: selection.clearSelection,
  openDetails: modals.openDetails,
})

const {
  hostnames,
  loading,
  notFound,
  decodedZoneName,
  zonesPath,
  dnspodLinked,
  cloudflareDnsLinked,
  originSuggestions,
  columns,
  pagination,
  hostnameAvatar,
  hostnameAvatarColor,
  hostnameRowKey,
  resetHostnamesState,
  load,
  handleRefresh,
  dnspodProviders,
  cloudflareProviders,
  dnspodZones,
  cloudflareDnsZones,
} = hostnamesApi

function preferredDomainOf(record: SaaSHostname): string {
  return String(record.custom_metadata?.preferred_domain || '').trim()
}

const {
  preferredDomains,
  showPreferredManager,
  loadPreferredDomains,
  openPreferredManager,
  onPreferredUpdate,
} = preferred

const { selectedHostnames, selectHostnames, clearSelection } = selection

const {
  editingHostname,
  showCreateForm,
  showDetails,
  showFallbackOrigin,
  detailLoading,
  openFallbackOrigin,
  onFallbackUpdated,
  openCreate,
  openEdit,
  openDetails,
  handleDetailsOpenChange,
  resetModals,
} = modals

const {
  creating,
  savingEdit,
  deleting,
  deletingText,
  refreshing,
  applyingPreferred,
  applyingPreferredText,
  create,
  update,
  refreshHostname,
  askDelete,
  askBatchDelete,
  askBatchUpdatePreferred,
  applyPreferredDomainToList,
} = crud

const batchActions = computed(() => [
  {
    key: 'preferred',
    label: '批量改优选',
    disabled: !dnspodLinked.value,
  },
])

function onBatchAction(key: string) {
  if (key === 'preferred') askBatchUpdatePreferred()
}

function onHostnameAction(key: string, record: SaaSHostname) {
  if (key === 'detail') openDetails(record)
  else if (key === 'edit') openEdit(record)
  else if (key === 'delete') askDelete(record)
}

onMounted(async () => {
  await load()
  loadPreferredDomains()
})

watch(
  () => props.provider,
  async () => {
    resetContext()
    resetHostnamesState()
    await load()
    loadPreferredDomains()
  }
)

watch(
  () => props.zoneName,
  async () => {
    resetContext()
    await load()
  }
)

function resetContext() {
  resetModals()
  clearSelection()
}
</script>
