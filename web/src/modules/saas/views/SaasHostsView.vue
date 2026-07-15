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
    <a-alert
      v-if="applyingPreferred"
      type="info"
      show-icon
      style="margin-bottom: 12px"
      :message="applyingPreferredText || '正在一键切换优选域名...'"
    />
    <BatchToolbar
      :count="selectedHostnames.length"
      :deleting="deleting"
      delete-text="批量删除"
      @delete="askBatchDelete"
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
          <a-space size="small">
            <a-avatar size="small" :style="{ background: hostnameAvatarColor() }">{{
              hostnameAvatar(record.hostname)
            }}</a-avatar>
            <a @click="openDetails(record)">{{ record.hostname }}</a>
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
          <div class="origin-cell">
            <a-tag v-if="!record.custom_origin_server" color="blue">默认回源</a-tag>
            <a-typography-text
              v-else
              :ellipsis="{ tooltip: record.custom_origin_server }"
              style="max-width: 140px; display: inline-block"
            >
              {{ record.custom_origin_server }}
            </a-typography-text>
          </div>
        </template>
        <template v-else-if="column.key === 'preferred_domain'">
          <div class="origin-cell">
            <a-typography-text type="secondary" v-if="!preferredDomainOf(record)">—</a-typography-text>
            <a-typography-text
              v-else
              :ellipsis="{ tooltip: preferredDomainOf(record) }"
              style="max-width: 160px; display: inline-block"
            >
              {{ preferredDomainOf(record) }}
            </a-typography-text>
          </div>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space size="small">
            <a-button
              type="link"
              size="small"
              :disabled="creating || savingEdit || deleting"
              @click="openDetails(record)"
              >详情</a-button
            >
            <a-dropdown>
              <a-button type="link" size="small" :disabled="creating || savingEdit || deleting">更多</a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item @click="openEdit(record)">编辑</a-menu-item>
                  <a-menu-item danger @click="askDelete(record)">删除</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </a-space>
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
import { ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { statusColor, statusLabel, formatDate } from '../utils/saas'
import ListToolbar from '@/shared/components/ListToolbar.vue'
import BatchToolbar from '@/shared/components/BatchToolbar.vue'
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
  refreshing,
  applyingPreferred,
  applyingPreferredText,
  create,
  update,
  refreshHostname,
  askDelete,
  askBatchDelete,
  applyPreferredDomainToList,
} = crud

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
