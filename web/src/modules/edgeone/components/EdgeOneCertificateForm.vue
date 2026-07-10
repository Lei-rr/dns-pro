<template>
  <a-form layout="vertical">
    <a-form-item label="HTTPS 配置">
      <a-select v-model:value="form.https_mode">
        <a-select-option value="disable">不配置</a-select-option>
        <a-select-option value="eofreecert">EdgeOne 免费证书</a-select-option>
        <a-select-option value="sslcert">SSL 证书 ID</a-select-option>
      </a-select>
    </a-form-item>
    <a-descriptions v-if="certificate" title="当前证书" bordered size="small" :column="1" style="margin-bottom: 16px">
      <a-descriptions-item v-for="item in certificateDetails" :key="item.label" :label="item.label">
        <a-tag v-if="item.status" :color="statusColor(item.status)">{{ item.value }}</a-tag>
        <template v-else>{{ item.value }}</template>
      </a-descriptions-item>
    </a-descriptions>
    <a-form-item v-if="showCertId" label="证书 ID" required>
      <a-input v-model:value="form.cert_id" placeholder="请输入证书 ID" />
    </a-form-item>
    <a-space style="display: flex; justify-content: flex-end">
      <a-button :disabled="saving" @click="$emit('cancel')">取消</a-button>
      <a-button type="primary" :loading="saving" @click="submit">保存</a-button>
    </a-space>
  </a-form>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { message } from '@/shared/plugins/antDesignVue'
import { certificateStatusColor, certificateStatusLabel } from '../utils/format'
import type { EdgeOneAccelerationDomain, EdgeOneCertificateItem } from '@/types'

const props = defineProps<{
  modelValue?: EdgeOneAccelerationDomain | null
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'save', form: Record<string, unknown>): void
  (e: 'cancel'): void
}>()

const form = ref<Record<string, unknown>>({ https_mode: 'disable', cert_id: '' })

const showCertId = computed(() => form.value.https_mode === 'sslcert')
const certificate = computed(() => {
  const certificate = props.modelValue?.certificate || {}
  const list = certificate.items || certificate.list || []
  return list[0] || null
})
const modeTextMap: Record<string, string> = {
  disable: '未配置',
  eofreecert: 'EdgeOne 免费证书',
  sslcert: 'SSL 证书 ID',
}

const modeText = computed(() => modeTextMap[form.value.https_mode as string] || (form.value.https_mode as string))
const certificateDetails = computed(() => {
  if (!certificate.value) return []
  return [
    { label: '证书类型', value: certificateTypeLabel(certificate.value.type) },
    { label: '自动更新', value: autoRenewText() },
    { label: '到期时间', value: formatTime(certificate.value.expire_time) },
    {
      label: '状态',
      value: certificateStatusLabel(certificate.value.status || ''),
      status: certificate.value.status,
    },
  ]
})

watch(
  () => props.modelValue,
  (value) => {
    const certificate = value?.certificate || {}
    const list = certificate.items || certificate.list || []
    form.value = {
      https_mode: certificate.mode || 'disable',
      cert_id: list[0]?.cert_id || '',
    }
  },
  { immediate: true }
)

function submit() {
  if (showCertId.value && !String(form.value.cert_id || '').trim()) {
    message.error('证书 ID 不能为空')
    return
  }
  emit('save', form.value)
}
const certificateTypeLabels: Record<string, string> = {
  default: '免费证书',
  free: '免费证书',
  upload: '上传证书',
  managed: '托管证书',
}

function certificateTypeLabel(type: string | undefined) {
  return certificateTypeLabels[type || ''] || type || '-'
}
function autoRenewText() {
  if (form.value.https_mode === 'eofreecert' || certificate.value?.type === 'default') return '到期前 15 天自动更新'
  return '-'
}
function statusColor(status: string | undefined) {
  return certificateStatusColor(status || '')
}
function formatTime(value: string | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
</script>
