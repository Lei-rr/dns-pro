<template>
  <section>
    <ListToolbar
      back-text="返回站点"
      :title="displayZoneName || decodedZoneId"
      subtitle="EdgeOne 加速域名"
      :show-search="false"
      @back="router.push(zonesPath)"
    >
      <template #actions>
        <a-button :loading="loading" :disabled="saving || deleting || statusUpdating" @click="handleRefresh">刷新</a-button>
        <a-button
          v-if="!notFound"
          type="primary"
          :disabled="saving || deleting || statusUpdating || !displayZoneName"
          @click="create"
          >添加加速域名</a-button
        >
      </template>
    </ListToolbar>
    <JobProgressAlert :running="deleting" :text="deletingText" />
    <JobProgressAlert :running="statusUpdating" :text="statusUpdatingText" tone="info" />
    <a-result v-if="notFound" status="404" title="站点不存在或未配置" :sub-title="decodedZoneId">
      <template #extra><a-button type="primary" @click="router.push(zonesPath)">返回 EdgeOne</a-button></template>
    </a-result>
    <template v-else>
      <BatchToolbar
        :count="selectedRecords.length"
        :deleting="deleting || statusUpdating"
        delete-text="批量删除"
        :delete-disabled="batchDeleteDisabled"
        :actions="[
          {
            key: 'offline',
            label: '批量停用',
            loading: statusUpdating,
            disabled: selectedRecords.every((record) => record.status === 'offline'),
          },
        ]"
        @delete="askBatchRemove"
        @action="
          (key) => {
            if (key === 'offline') askBatchDisable()
          }
        "
        @clear="clearSelection"
      />
      <EdgeOneRecordTable
        :records="records"
        :loading="loading"
        :pagination="pagination"
        :selection-reset-key="selectionResetKey"
        :actions-disabled="saving || deleting || statusUpdating"
        empty-text="暂无匹配的加速域名"
        @edit="edit"
        @status="askStatus"
        @certificate="configureCertificate"
        @delete="askRemove"
        @change="handleTableChange"
        @selection-change="selectedRecords = $event"
      />
      <a-modal
        v-model:open="showForm"
        :title="editing ? '编辑加速域名' : '添加加速域名'"
        :footer="null"
        destroy-on-close
      >
        <EdgeOneRecordForm
          :model-value="editing"
          :saving="saving"
          :zone-name="displayZoneName"
          :dnspod-linked="dnspodLinked"
          @save="save"
          @cancel="showForm = false"
        />
      </a-modal>
      <a-modal v-model:open="showCertForm" title="HTTPS 配置" :footer="null" destroy-on-close>
        <EdgeOneCertificateForm
          :model-value="certEditing"
          :saving="saving"
          @save="saveCertificate"
          @cancel="showCertForm = false"
        />
      </a-modal>
    </template>
  </section>
</template>

<script setup lang="ts">
import ListToolbar from '@/shared/components/ListToolbar.vue'
import JobProgressAlert from '@/shared/components/JobProgressAlert.vue'
import BatchToolbar from '@/shared/components/BatchToolbar.vue'
import EdgeOneCertificateForm from '../components/EdgeOneCertificateForm.vue'
import EdgeOneRecordForm from '../components/EdgeOneRecordForm.vue'
import EdgeOneRecordTable from '../components/EdgeOneRecordTable.vue'
import { useEdgeOneRecords } from '../composables/useEdgeOneRecords'

const props = defineProps<{
  provider: string
  zoneId: string
}>()

const recordsApi = useEdgeOneRecords(props)

const {
  router,
  records,
  selectedRecords,
  selectionResetKey,
  notFound,
  editing,
  certEditing,
  showForm,
  showCertForm,
  loading,
  saving,
  deleting,
  deletingText,
  statusUpdatingText,
  statusUpdating,
  decodedZoneId,
  displayZoneName,
  zonesPath,
  dnspodLinked,
  pagination,
  batchDeleteDisabled,
  load,
  handleRefresh,
  handleTableChange,
  edit,
  create,
  clearSelection,
  configureCertificate,
  save,
  saveCertificate,
  askStatus,
  askRemove,
  askBatchRemove,
  askBatchDisable,
} = recordsApi
</script>
