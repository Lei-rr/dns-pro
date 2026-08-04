<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Switch } from '@/shared/ui/switch'
import { saasApi } from '@/features/saas/api/saas-api'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { serverFieldErrors } from '@/shared/lib/field-errors'
import { confirmDialog } from '@/shared/ui/confirm'
import { createScopeGeneration } from '@/shared/lib/scope-generation'

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
const originError = ref('')
const scopeGeneration = createScopeGeneration()

function claimScope() {
  return scopeGeneration.claim({ providerId: props.providerId, zoneName: props.zoneName })
}

const statusLabel = computed(() => {
  const key = String(status.value || '')
    .trim()
    .toLowerCase()
  return (
    {
      initializing: '初始化中',
      pending_deployment: '待部署',
      pending_deletion: '删除中',
      active: '已生效',
    }[key] || (key ? '状态未知' : '-')
  )
})

const canSave = computed(() => {
  if (!enabled.value) return true
  return !!origin.value.trim()
})

async function load() {
  const owner = claimScope()
  loading.value = true
  errors.value = []
  try {
    const response = await saasApi.fallbackOrigin(owner.value.providerId, owner.value.zoneName)
    if (!owner.active()) return
    const data = response.data || {}
    currentOrigin.value = String(data.origin || '')
    status.value = String(data.status || '')
    enabled.value = !!currentOrigin.value
    origin.value = currentOrigin.value
    const list = Array.isArray(data.errors) ? data.errors : []
    errors.value = list.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
  } catch (error) {
    if (owner.active()) toast.error(errorMessage(error))
  } finally {
    if (owner.active()) loading.value = false
  }
}

async function save() {
  if (saving.value) return
  originError.value = canSave.value ? '' : '请填写源服务器'
  if (originError.value) return
  const owner = claimScope()
  const nextEnabled = enabled.value
  const nextOrigin = origin.value.trim()
  saving.value = true
  try {
    if (!nextEnabled) {
      await saasApi.deleteFallbackOrigin(owner.value.providerId, owner.value.zoneName)
      if (!owner.active()) return
      toast.success('默认回源已关闭')
      emit('updated', '')
    } else {
      await saasApi.setFallbackOrigin(owner.value.providerId, owner.value.zoneName, nextOrigin)
      if (!owner.active()) return
      toast.success('默认回源已保存')
      emit('updated', nextOrigin)
    }
    open.value = false
  } catch (error) {
    if (!owner.active()) return
    originError.value = serverFieldErrors(error).origin || originError.value
    toast.error(errorMessage(error))
  } finally {
    if (owner.active()) saving.value = false
  }
}

async function removeOrigin() {
  if (deleting.value) return
  const pendingOwner = scopeGeneration.capture({ providerId: props.providerId, zoneName: props.zoneName })
  if (
    !(await confirmDialog({
      title: '确认删除',
      description: '确认删除默认回源？',
      confirmText: '删除',
      destructive: true,
    }))
  )
    return
  if (!pendingOwner.active()) return
  const owner = claimScope()
  deleting.value = true
  try {
    await saasApi.deleteFallbackOrigin(owner.value.providerId, owner.value.zoneName)
    if (!owner.active()) return
    toast.success('已删除默认回源')
    emit('updated', '')
    open.value = false
  } catch (error) {
    if (owner.active()) toast.error(errorMessage(error))
  } finally {
    if (owner.active()) deleting.value = false
  }
}

watch(open, (value) => {
  if (value) {
    load()
    return
  }
  scopeGeneration.invalidate()
  loading.value = false
  saving.value = false
  deleting.value = false
})
watch(
  () => [props.providerId, props.zoneName],
  () => {
    scopeGeneration.invalidate()
    open.value = false
    loading.value = false
    saving.value = false
    deleting.value = false
  }
)
onUnmounted(() => scopeGeneration.invalidate())
</script>

<template>
  <AppDialog v-model:open="open" :title="`默认回源 · ${zoneName}`" description="为当前 SaaS 站点配置默认回退源服务器。">
    <FieldGroup>
      <div
        v-if="errors.length"
        class="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      >
        <div v-for="(msg, index) in errors" :key="index">{{ msg }}</div>
      </div>
      <Field v-if="currentOrigin">
        <FieldLabel>当前状态</FieldLabel>
        <div class="flex items-center gap-2">
          <StatusBadge>{{ statusLabel }}</StatusBadge>
          <span class="text-muted-foreground text-sm">{{ currentOrigin }}</span>
        </div>
      </Field>
      <Field orientation="horizontal">
        <Switch v-model="enabled" />
        <FieldLabel>启用默认回源</FieldLabel>
      </Field>
      <Field v-if="enabled" :data-invalid="!!originError">
        <FieldLabel>源服务器</FieldLabel>
        <Input v-model="origin" :placeholder="`origin.${zoneName}`" @keyup.enter="save" />
        <FieldError :errors="originError ? [originError] : []" />
      </Field>
      <div v-if="currentOrigin">
        <LoadingButton variant="outline" class="text-destructive" :loading="deleting" @click="removeOrigin">
          删除默认回源
        </LoadingButton>
      </div>
    </FieldGroup>
    <template #footer>
      <Button variant="outline" @click="open = false">取消</Button>
      <LoadingButton :loading="saving" :disabled="!canSave" @click="save">保存</LoadingButton>
    </template>
  </AppDialog>
</template>
