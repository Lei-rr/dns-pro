<template>
  <a-modal
    :open="open"
    @update:open="emitOpen"
    :title="'默认回源 · ' + zoneName"
    :confirm-loading="saving"
    :ok-button-props="{ disabled: !canSave }"
    ok-text="保存"
    cancel-text="取消"
    @ok="save"
  >
    <a-spin :spinning="loading">
      <a-alert v-if="errorMessages.length" type="error" show-icon style="margin-bottom: 16px">
        <template #description>
          <ul style="margin: 0; padding-left: 18px">
            <li v-for="(msg, i) in errorMessages" :key="i">{{ msg }}</li>
          </ul>
        </template>
      </a-alert>
      <a-form layout="vertical">
        <a-form-item v-if="hasExisting" label="当前状态">
          <a-tag :color="statusColor">{{ statusLabel }}</a-tag>
          <a-typography-text v-if="hasExisting" type="secondary" style="margin-left: 8px">{{
            currentOrigin
          }}</a-typography-text>
        </a-form-item>
        <a-form-item label="启用默认回源">
          <a-switch v-model:checked="enabled" />
        </a-form-item>
        <a-form-item
          v-if="enabled"
          label="源服务器"
          required
          :validate-status="originRequired || originSuffixInvalid ? 'error' : ''"
          :help="originError || '如 origin' + requiredSuffix"
        >
          <a-input v-model:value="origin" :placeholder="'origin' + requiredSuffix" @press-enter="save" />
        </a-form-item>
        <a-form-item v-if="hasExisting">
          <a-button danger :loading="deleting" @click="askDelete">删除默认回源</a-button>
        </a-form-item>
      </a-form>
    </a-spin>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { saasApi } from '../utils/api'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'

const props = defineProps<{
  open?: boolean
  provider: string
  zoneName: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'updated', origin: string): void
}>()

const FALLBACK_STATUS_LABELS: Record<string, string> = {
  initializing: '初始化中',
  pending_deployment: '待部署',
  pending_deletion: '删除中',
  active: '已生效',
}

const FALLBACK_STATUS_COLORS: Record<string, string> = {
  initializing: 'gold',
  pending_deployment: 'gold',
  pending_deletion: 'red',
  active: 'green',
}

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const enabled = ref(false)
const origin = ref('')
const currentOrigin = ref('')
const currentStatus = ref('')
const currentErrors = ref<unknown[]>([])

const trimmedOrigin = computed(() =>
  String(origin.value || '')
    .trim()
    .toLowerCase()
)
const requiredSuffix = computed(() => '.' + String(props.zoneName || '').toLowerCase())
const originRequired = computed(() => enabled.value && !trimmedOrigin.value)
const originSuffixInvalid = computed(() => {
  if (!enabled.value || !trimmedOrigin.value) return false
  const v = trimmedOrigin.value
  const suffix = requiredSuffix.value
  return v === props.zoneName.toLowerCase() || !v.endsWith(suffix) || v === suffix.slice(1)
})
const originError = computed(() => {
  if (originRequired.value) return '请输入源服务器地址'
  if (originSuffixInvalid.value) return `源服务器必须是 ${props.zoneName} 的子域名(如 origin${requiredSuffix.value})`
  return ''
})
const canSave = computed(() => {
  if (originRequired.value || originSuffixInvalid.value) return false
  const next = enabled.value ? trimmedOrigin.value : ''
  return next !== currentOrigin.value
})
const hasExisting = computed(() => !!currentOrigin.value)
const statusLabel = computed(() => FALLBACK_STATUS_LABELS[currentStatus.value] || currentStatus.value || '-')
const statusColor = computed(
  () => FALLBACK_STATUS_COLORS[currentStatus.value] || (currentStatus.value ? 'blue' : 'default')
)
const errorMessages = computed(() => {
  return (currentErrors.value || [])
    .map((e) => {
      if (typeof e === 'string') return e
      return (
        (e as { message?: string; error?: string }).message ||
        (e as { message?: string; error?: string }).error ||
        JSON.stringify(e)
      )
    })
    .filter(Boolean)
})

watch(
  () => props.open,
  (value) => {
    if (value) load()
  }
)

async function load() {
  loading.value = true
  try {
    const response = await saasApi.fallbackOrigin(props.provider, props.zoneName, { refresh: true })
    const data = response.data || {}
    const originValue = data.origin || ''
    currentOrigin.value = originValue
    origin.value = originValue
    enabled.value = !!originValue
    currentStatus.value = data.status || ''
    currentErrors.value = Array.isArray(data.errors) ? data.errors : []
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}
async function save() {
  if (!canSave.value) return
  if (!enabled.value) {
    askDelete()
    return
  }
  saving.value = true
  try {
    const response = await saasApi.setFallbackOrigin(props.provider, props.zoneName, trimmedOrigin.value)
    const data = response.data || {}
    currentOrigin.value = data.origin || trimmedOrigin.value
    origin.value = currentOrigin.value
    currentStatus.value = data.status || ''
    currentErrors.value = Array.isArray(data.errors) ? data.errors : []
    message.success('默认回源已保存')
    emit('updated', currentOrigin.value)
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}
function askDelete() {
  modal.confirm({
    title: '删除默认回源',
    content: `确认删除 ${props.zoneName} 的默认回源?删除后,未配置自定义源服务器的主机名将无法回源。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => doDelete(),
  })
}
async function doDelete() {
  deleting.value = true
  try {
    await saasApi.deleteFallbackOrigin(props.provider, props.zoneName)
    currentOrigin.value = ''
    origin.value = ''
    enabled.value = false
    currentStatus.value = ''
    currentErrors.value = []
    message.success('默认回源已删除')
    emit('updated', '')
    emit('update:open', false)
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    deleting.value = false
  }
}
function close() {
  emit('update:open', false)
}
function emitOpen(value: boolean) {
  emit('update:open', value)
}
</script>
