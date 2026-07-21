<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Switch } from '@/shared/ui/switch'
import { saasApi } from '@/features/saas/api/saas'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { withMinLoading } from '@/shared/lib/loading'
import { confirmDelete, confirmDialog } from '@/shared/ui/confirm'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  providerId: string
  zoneName: string
}>()
const emit = defineEmits<{
  updated: [origin: string]
}>()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const enabled = ref(false)
const origin = ref('')
const currentOrigin = ref('')
const status = ref('')
const errors = ref<string[]>([])

const statusLabel = computed(() => {
  return (
    {
      initializing: '初始化中',
      pending_deployment: '待部署',
      pending_deletion: '删除中',
      active: '已生效',
    }[status.value] || status.value || '-'
  )
})

const canSave = computed(() => {
  if (!enabled.value) return true
  return !!origin.value.trim()
})

async function load() {
  loading.value = true
  errors.value = []
  try {
    const response = await saasApi.fallbackOrigin(props.providerId, props.zoneName, { refresh: true })
    const data = response.data || {}
    currentOrigin.value = String(data.origin || '')
    status.value = String(data.status || '')
    enabled.value = !!currentOrigin.value
    origin.value = currentOrigin.value
    const list = Array.isArray(data.errors) ? data.errors : []
    errors.value = list.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!canSave.value) {
    toast.warning('请填写源服务器')
    return
  }
  saving.value = true
  try {
    if (!enabled.value) {
      await saasApi.deleteFallbackOrigin(props.providerId, props.zoneName)
      toast.success('默认回源已关闭')
      emit('updated', '')
    } else {
      await saasApi.setFallbackOrigin(props.providerId, props.zoneName, origin.value.trim())
      toast.success('默认回源已保存')
      emit('updated', origin.value.trim())
    }
    open.value = false
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function removeOrigin() {
  if (!(await confirmDialog({ title: '确认删除', description: '确认删除默认回源？', confirmText: '删除', destructive: true }))) return
  deleting.value = true
  try {
    await saasApi.deleteFallbackOrigin(props.providerId, props.zoneName)
    toast.success('已删除默认回源')
    emit('updated', '')
    open.value = false
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    deleting.value = false
  }
}

watch(open, (value) => {
  if (value) load()
})
</script>

<template>
  <AppDialog
    v-model:open="open"
    :title="`默认回源 · ${zoneName}`"
    description="为当前 SaaS 站点配置默认回退源服务器。"
  >
    <FieldGroup>
      <div v-if="errors.length" class="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <div v-for="(msg, index) in errors" :key="index">{{ msg }}</div>
      </div>
      <Field v-if="currentOrigin">
        <FieldLabel>当前状态</FieldLabel>
        <div class="flex items-center gap-2">
          <Badge variant="secondary">{{ statusLabel }}</Badge>
          <span class="text-muted-foreground text-sm">{{ currentOrigin }}</span>
        </div>
      </Field>
      <Field orientation="horizontal">
        <Switch v-model="enabled" />
        <FieldLabel>启用默认回源</FieldLabel>
      </Field>
      <Field v-if="enabled">
        <FieldLabel>源服务器</FieldLabel>
        <Input v-model="origin" :placeholder="`origin.${zoneName}`" @keyup.enter="save" />
      </Field>
      <div v-if="currentOrigin">
        <Button variant="outline" class="text-destructive" :loading="deleting" @click="removeOrigin">
          删除默认回源
        </Button>
      </div>
    </FieldGroup>
    <template #footer>
      <Button variant="outline" @click="open = false">取消</Button>
      <Button :loading="saving" :disabled="!canSave" @click="save">保存</Button>
    </template>
  </AppDialog>
</template>
