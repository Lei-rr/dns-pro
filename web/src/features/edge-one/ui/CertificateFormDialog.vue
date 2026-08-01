<script setup lang="ts">
import { reactive, computed, ref, watch } from 'vue'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { certificateStatusLabel } from '@/features/edge-one/lib/status'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  certificate?: {
    mode?: string
    items?: Array<{ cert_id?: string; status?: string; type?: string; expire_time?: string }>
    list?: Array<{ cert_id?: string; status?: string; type?: string; expire_time?: string }>
  }
  errors?: Record<string, string>
  saving?: boolean
}>()
const emit = defineEmits<{
  save: [payload: Record<string, unknown>]
}>()

const localErrors = ref<Record<string, string>>({})
const errors = computed(() => ({ ...(props.errors || {}), ...localErrors.value }))
const form = reactive({
  https_mode: 'disable',
  cert_id: '',
})

const showCertId = computed(() => form.https_mode === 'sslcert')
const currentCert = computed(() => {
  const c = props.certificate
  if (!c) return null
  const list = c.items || c.list || []
  return list[0] || null
})

watch(open, (value) => {
  if (value) {
    localErrors.value = {}
    form.https_mode = props.certificate?.mode || 'disable'
    form.cert_id = currentCert.value?.cert_id || ''
  }
})

function submit() {
  if (props.saving) return
  localErrors.value = {}
  if (showCertId.value && !form.cert_id.trim()) localErrors.value.cert_id = '证书 ID 不能为空'
  if (Object.keys(localErrors.value).length) return
  emit('save', { ...form })
}
</script>

<template>
  <AppDialog v-model:open="open" title="HTTPS 配置" description="配置加速域名的 HTTPS 证书。">
    <FieldGroup>
      <div v-if="currentCert" class="rounded-lg border p-3">
        <div class="mb-2 text-sm font-medium">当前证书</div>
        <div class="space-y-1 text-sm">
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground">类型：</span>
            <span>{{ currentCert.type || '-' }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground">状态：</span>
            <Badge variant="secondary">{{ certificateStatusLabel(currentCert.status) }}</Badge>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground">到期：</span>
            <span>{{ currentCert.expire_time || '-' }}</span>
          </div>
        </div>
      </div>

      <Field>
        <FieldLabel>HTTPS 方式</FieldLabel>
        <Select v-model="form.https_mode">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="HTTPS 方式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="disable">不配置</SelectItem>
            <SelectItem value="eofreecert">EdgeOne 免费证书</SelectItem>
            <SelectItem value="sslcert">SSL 证书 ID</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field v-if="showCertId" :data-invalid="!!errors.cert_id">
        <FieldLabel>证书 ID</FieldLabel>
        <Input v-model="form.cert_id" placeholder="请输入证书 ID" />
        <FieldError :errors="errors.cert_id ? [errors.cert_id] : []" />
      </Field>
    </FieldGroup>

    <template #footer>
      <Button variant="outline" @click="open = false">取消</Button>
      <LoadingButton :loading="saving" @click="submit">保存</LoadingButton>
    </template>
  </AppDialog>
</template>
