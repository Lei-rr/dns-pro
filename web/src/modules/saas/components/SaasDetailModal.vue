<template>
  <a-modal :open="open" @update:open="emitOpen" title="自定义主机名详情" :footer="null" width="760px" destroy-on-close>
    <a-spin :spinning="loading">
      <template v-if="hostnameRecord">
        <a-alert v-if="errorMessages.length" type="error" show-icon style="margin-bottom: 16px">
          <template #description>
            <ul style="margin: 0; padding-left: 18px">
              <li v-for="(msg, i) in errorMessages" :key="i">{{ msg }}</li>
            </ul>
          </template>
        </a-alert>

        <a-descriptions bordered size="small" :column="1" style="margin-bottom: 16px">
          <a-descriptions-item label="主机名">{{ hostnameRecord.hostname || '-' }}</a-descriptions-item>
          <a-descriptions-item label="主机名状态">
            <a-tag :color="statusColor(hostnameRecord.status as string)">{{
              statusLabel(hostnameRecord.status as string)
            }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item v-if="hostnameRecord.custom_origin_server" label="回源服务器">{{
            hostnameRecord.custom_origin_server
          }}</a-descriptions-item>
          <a-descriptions-item v-if="sslSettings.min_tls_version" label="最低 TLS 版本">{{
            minTlsLabel(sslSettings.min_tls_version as string)
          }}</a-descriptions-item>
          <a-descriptions-item v-if="sslRecord.issuer" label="证书颁发">{{ sslRecord.issuer }}</a-descriptions-item>
          <a-descriptions-item v-if="sslRecord.expires_on" label="证书到期">{{
            formatDate(sslRecord.expires_on as string)
          }}</a-descriptions-item>
          <a-descriptions-item label="证书状态">
            <a-tag :color="statusColor(sslRecord.status as string)">{{
              statusLabel(sslRecord.status as string)
            }}</a-tag>
          </a-descriptions-item>
        </a-descriptions>

        <a-descriptions
          v-if="needsOwnershipHelp && ownershipVerification.name"
          bordered
          size="small"
          :column="1"
          title="域名所有权验证（TXT）"
          style="margin-bottom: 16px"
        >
          <a-descriptions-item label="记录名">{{ ownershipVerification.name }}</a-descriptions-item>
          <a-descriptions-item label="记录值">{{ ownershipVerification.value || '-' }}</a-descriptions-item>
        </a-descriptions>

        <a-descriptions
          v-for="(rec, index) in dcvDelegationRecords"
          :key="'dcv-' + index"
          bordered
          size="small"
          :column="1"
          title="自定义主机名的 DCV 委派（CNAME）"
          style="margin-bottom: 16px"
        >
          <a-descriptions-item label="记录名">{{ rec.cname }}</a-descriptions-item>
          <a-descriptions-item label="记录值">{{ rec.cname_target }}</a-descriptions-item>
        </a-descriptions>

        <details v-if="acmeTempRecords.length" style="margin-bottom: 16px">
          <summary style="cursor: pointer; padding: 4px 0; color: rgba(0, 0, 0, 0.45)">
            临时 ACME 验证 TXT（{{ acmeTempRecords.length }} 条，每次续期变化，添加 DCV 委派 CNAME 后无需关注）
          </summary>
          <a-descriptions
            v-for="(rec, index) in acmeTempRecords"
            :key="'acme-' + index"
            bordered
            size="small"
            :column="1"
            :title="'临时验证（' + rec.type + '）'"
            style="margin-top: 12px"
          >
            <a-descriptions-item label="记录名">{{ rec.name }}</a-descriptions-item>
            <a-descriptions-item label="记录值">{{ rec.value }}</a-descriptions-item>
          </a-descriptions>
        </details>

        <div style="display: flex; justify-content: flex-end; gap: 8px">
          <a-button @click="$emit('edit', hostnameRecord)">编辑</a-button>
          <a-button :loading="refreshing" @click="$emit('refresh', hostnameRecord)">刷新状态</a-button>
          <a-button @click="close">关闭</a-button>
        </div>
      </template>
    </a-spin>
  </a-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { statusColor, statusLabel, minTlsLabel, formatDate } from '../utils/saas'

const props = defineProps<{
  open?: boolean
  hostname?: Record<string, unknown> | null
  loading?: boolean
  refreshing?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'refresh', hostname: Record<string, unknown>): void
  (e: 'edit', hostname: Record<string, unknown>): void
}>()

const hostnameRecord = computed(() => (props.hostname || {}) as Record<string, unknown>)
const sslRecord = computed(() => (hostnameRecord.value.ssl as Record<string, unknown>) || {})
const sslSettings = computed(() => (sslRecord.value.settings as Record<string, unknown>) || {})
const ownershipVerification = computed(
  () => (hostnameRecord.value.ownership_verification as Record<string, unknown>) || {}
)

const needsDcvHelp = computed(() => {
  const status = sslRecord.value.status as string
  const finalStates = ['active', 'deleted', 'deactivated', 'pending_deletion']
  return !!status && !finalStates.includes(status)
})
const needsOwnershipHelp = computed(() => {
  const status = hostnameRecord.value.status as string
  const finalStates = ['active', 'active_renewing', 'moved', 'deleted', 'blocked', 'pending_deletion']
  return !!status && !finalStates.includes(status)
})
const errorMessages = computed(() => {
  const out: string[] = []
  const top = (hostnameRecord.value.verification_errors as unknown[]) || []
  for (const e of top) {
    if (typeof e === 'string') out.push(e)
    else if (e && typeof e === 'object')
      out.push(
        (e as { message?: string; error?: string }).message ||
          (e as { message?: string; error?: string }).error ||
          JSON.stringify(e)
      )
  }
  const ssl = (sslRecord.value.validation_errors as unknown[]) || []
  for (const e of ssl) {
    if (typeof e === 'string') out.push(e)
    else if (e && typeof e === 'object')
      out.push(
        (e as { message?: string; error?: string }).message ||
          (e as { message?: string; error?: string }).error ||
          JSON.stringify(e)
      )
  }
  return out
})
const dcvDelegationRecords = computed(() => {
  if (!needsDcvHelp.value) return []

  const records = (sslRecord.value.dcv_delegation_records as Array<{ cname: string; cname_target: string }>) || []
  if (Array.isArray(records) && records.length > 0) return records

  const uuid = sslRecord.value.dcv_delegation_uuid as string
  const fqdn = hostnameRecord.value.hostname as string
  if (uuid && fqdn) {
    return [
      {
        cname: '_acme-challenge.' + fqdn,
        cname_target: fqdn + '.' + uuid + '.dcv.cloudflare.com',
      },
    ]
  }
  return []
})
const acmeTempRecords = computed(() => {
  if (!needsDcvHelp.value) return []

  const records = (sslRecord.value.validation_records as Array<Record<string, unknown>>) || []
  if (!Array.isArray(records)) return []
  return records
    .map((r) => {
      if (r?.txt_name && r?.txt_value)
        return {
          type: 'TXT',
          name: r.txt_name as string,
          value: r.txt_value as string,
          status: r.status as string | undefined,
        }
      if (r?.http_url && r?.http_body)
        return {
          type: 'HTTP',
          name: r.http_url as string,
          value: r.http_body as string,
          status: r.status as string | undefined,
        }
      return null
    })
    .filter((item): item is { type: string; name: string; value: string; status: string | undefined } => !!item)
})

function close() {
  emit('update:open', false)
}
function emitOpen(value: boolean) {
  emit('update:open', value)
}
</script>
