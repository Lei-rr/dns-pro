<template>
  <a-modal
    :open="open"
    @update:open="emitOpen"
    :title="title"
    :confirm-loading="confirmLoading"
    :ok-button-props="{ disabled: !canSubmit }"
    ok-text="保存"
    cancel-text="取消"
    @ok="submit"
  >
    <a-form layout="vertical">
      <a-form-item label="域名（Cloudflare 站点）" required>
        <a-select
          v-model:value="form.zone_id"
          placeholder="选择已托管的 Cloudflare 站点"
          show-search
          :filter-option="filterZoneOption"
        >
          <a-select-option v-for="z in zoneOptions" :key="z.value" :value="z.value" :label="z.label">{{
            z.label
          }}</a-select-option>
        </a-select>
      </a-form-item>
      <a-form-item label="公共主机名" required>
        <a-input-group compact>
          <a-input v-model:value="form.prefix" placeholder="如 sss 或 @ 表示根域" style="width: 45%" />
          <a-input :value="selectedZone ? '.' + selectedZone.name : ''" disabled style="width: 55%" />
        </a-input-group>
      </a-form-item>
      <a-form-item label="协议" required>
        <a-select v-model:value="form.protocol">
          <a-select-option v-for="p in protocols" :key="p.value" :value="p.value">{{ p.label }}</a-select-option>
        </a-select>
      </a-form-item>
      <a-form-item label="本地服务地址" required>
        <a-input v-model:value="form.address" placeholder="如 localhost:8888 或 192.168.1.10:3000" />
      </a-form-item>
      <a-form-item label="路径（可选）">
        <a-input v-model:value="form.path" placeholder="如 /api，留空表示所有路径" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { protocolOptions, parseServiceUrl, hostnamePrefix } from '../utils/format'

const props = defineProps<{
  open?: boolean
  confirmLoading?: boolean
  zones?: Array<Record<string, unknown>>
  initialRoute?: Record<string, unknown> | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submit', form: Record<string, unknown>): void
}>()

const form = ref<Record<string, unknown>>(defaultForm())

const protocols = computed(() => protocolOptions)
const zoneOptions = computed(() =>
  (props.zones || []).map((zone) => ({
    value: zone.id as string,
    label: zone.name as string,
    name: zone.name as string,
  }))
)
const selectedZone = computed(() => zoneOptions.value.find((z) => z.value === form.value.zone_id) || null)
const fullHostname = computed(() => {
  const prefix = String(form.value.prefix || '')
    .trim()
    .toLowerCase()
  const zone = selectedZone.value?.name || ''
  if (!zone) return ''
  if (prefix === '' || prefix === '@') return zone
  return `${prefix}.${zone}`
})
const canSubmit = computed(() =>
  Boolean(form.value.zone_id && fullHostname.value && String(form.value.address || '').trim())
)
const title = computed(() => (props.initialRoute ? '编辑路由' : '添加路由'))

watch(
  () => props.open,
  (value) => {
    if (value) form.value = defaultForm()
  }
)

function matchZone(hostname: string) {
  const fqdn = String(hostname || '').toLowerCase()
  const sorted = [...(props.zones || [])].sort((a, b) => String(b.name || '').length - String(a.name || '').length)
  return sorted.find((z) => z.name && (fqdn === z.name || fqdn.endsWith('.' + z.name))) || null
}
function defaultForm() {
  const initial = props.initialRoute
  if (initial?.hostname) {
    const matched = matchZone(initial.hostname as string)
    const { protocol, address } = parseServiceUrl(initial.service as string)
    return {
      zone_id: matched?.id || '',
      prefix: hostnamePrefix(initial.hostname as string, matched?.name as string) || '@',
      protocol,
      address,
      path: initial.path || '',
    }
  }
  return { zone_id: '', prefix: '', protocol: 'http', address: '', path: '' }
}
function emitOpen(value: boolean) {
  emit('update:open', value)
}
function filterZoneOption(input: string, option?: { label?: string }) {
  return String(option?.label || '')
    .toLowerCase()
    .includes(input.toLowerCase())
}
function submit() {
  if (!canSubmit.value) return
  emit('submit', {
    zone_id: form.value.zone_id,
    hostname: fullHostname.value,
    protocol: form.value.protocol,
    address: String(form.value.address).trim(),
    path: String(form.value.path || '').trim(),
  })
}
</script>
