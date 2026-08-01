<script setup lang="ts">
import { reactive, computed, ref, watch } from 'vue'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Switch } from '@/shared/ui/switch'
import type { EdgeOneAccelerationDomain } from '@/features/edge-one/model/types'
import { edgeOneDomainFormValues, edgeOneDomainSubmitValues } from '@/features/edge-one/model/domain-command'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  zoneName: string
  dnspodLinked?: boolean
  saving?: boolean
  editing?: boolean
  domain?: EdgeOneAccelerationDomain | null
  errors?: Record<string, string>
}>()
const emit = defineEmits<{
  save: [payload: Record<string, unknown>]
}>()

const localErrors = ref<Record<string, string>>({})
const errors = computed(() => ({ ...(props.errors || {}), ...localErrors.value }))
const form = reactive({
  prefix: '',
  origin_type: 'IP_DOMAIN',
  origin: '',
  origin_protocol: 'HTTP',
  http_origin_port: 80,
  https_origin_port: 443,
  host_header: '',
  host_header_mode: 'accelerate',
  ipv6_status: 'follow',
  autoSync: false,
})

const fullDomain = computed(() => {
  const prefix = form.prefix.trim() || '@'
  if (prefix === '@' || !props.zoneName) return props.zoneName
  return `${prefix}.${props.zoneName}`
})

const showHttpPort = computed(() => ['FOLLOW', 'HTTP'].includes(form.origin_protocol))
const showHttpsPort = computed(() => ['FOLLOW', 'HTTPS'].includes(form.origin_protocol))
const showHostHeader = computed(() => form.origin_type === 'IP_DOMAIN')

watch(open, (value) => {
  if (value) localErrors.value = {}
  if (value) Object.assign(form, edgeOneDomainFormValues(props.domain, props.zoneName))
})

function submit() {
  if (props.saving) return
  localErrors.value = {}
  if (!form.origin.trim()) localErrors.value.origin = '请填写源站地址'
  if (Object.keys(localErrors.value).length) return
  emit('save', {
    ...edgeOneDomainSubmitValues(form),
    fullDomain: fullDomain.value,
    autoSync: form.autoSync,
  })
}
</script>

<template>
  <AppDialog
    v-model:open="open"
    :title="editing ? '编辑加速域名' : '添加加速域名'"
    description="创建 EdgeOne 加速域名并配置源站。"
    content-class="sm:max-w-2xl"
  >
    <FieldGroup>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>前缀</FieldLabel>
          <Input v-model="form.prefix" :disabled="editing" placeholder="www / * / @" />
        </Field>
        <Field>
          <FieldLabel>完整域名</FieldLabel>
          <Input :model-value="fullDomain" disabled class="bg-muted" />
        </Field>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>源站类型</FieldLabel>
          <Select v-model="form.origin_type">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="源站类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="IP_DOMAIN">IP/域名</SelectItem>
              <SelectItem value="COS">腾讯云 COS</SelectItem>
              <SelectItem value="AWS_S3">AWS S3</SelectItem>
              <SelectItem value="ORIGIN_GROUP">源站组</SelectItem>
              <SelectItem value="VOD">云点播</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field :data-invalid="!!errors.origin">
          <FieldLabel>源站地址</FieldLabel>
          <Input
            v-model="form.origin"
            :placeholder="form.origin_type === 'IP_DOMAIN' ? '1.2.3.4 或 origin.example.com' : ''"
          />
          <FieldError :errors="errors.origin ? [errors.origin] : []" />
        </Field>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>回源协议</FieldLabel>
          <Select v-model="form.origin_protocol">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="回源协议" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="HTTP">HTTP</SelectItem>
              <SelectItem value="HTTPS">HTTPS</SelectItem>
              <SelectItem value="FOLLOW">协议跟随</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>IPv6</FieldLabel>
          <Select v-model="form.ipv6_status">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="IPv6" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="follow">遵循站点</SelectItem>
              <SelectItem value="on">开启</SelectItem>
              <SelectItem value="off">关闭</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field v-if="showHttpPort">
          <FieldLabel>HTTP 端口</FieldLabel>
          <Input v-model="form.http_origin_port" type="number" />
        </Field>
        <Field v-if="showHttpsPort">
          <FieldLabel>HTTPS 端口</FieldLabel>
          <Input v-model="form.https_origin_port" type="number" />
        </Field>
      </div>

      <Field v-if="showHostHeader">
        <FieldLabel>回源 HOST 头</FieldLabel>
        <Select v-model="form.host_header_mode">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="HOST 头" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="accelerate">加速域名</SelectItem>
            <SelectItem value="custom">自定义</SelectItem>
          </SelectContent>
        </Select>
        <Input
          v-if="form.host_header_mode === 'custom'"
          v-model="form.host_header"
          class="mt-2"
          placeholder="自定义回源 HOST"
        />
      </Field>

      <Field v-if="dnspodLinked && !editing" orientation="horizontal">
        <Switch v-model="form.autoSync" />
        <FieldLabel>自动同步 DNSPod</FieldLabel>
      </Field>
    </FieldGroup>

    <template #footer>
      <Button variant="outline" @click="open = false">取消</Button>
      <LoadingButton :loading="saving" @click="submit">保存</LoadingButton>
    </template>
  </AppDialog>
</template>
