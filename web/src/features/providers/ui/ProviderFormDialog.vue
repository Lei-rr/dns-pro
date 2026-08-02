<script setup lang="ts">
import { AppDialog } from '@/shared/ui/dialog'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { fieldError, type FieldErrors } from '@/shared/lib/field-errors'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import type { Provider, ProviderDefinition } from '../model/types'
import { isProviderSecretField } from '../model/provider-fields'

export type ProviderFormModel = {
  id: string
  type: string
  name: string
  fields: Record<string, string>
}

const open = defineModel<boolean>('open', { required: true })
const form = defineModel<ProviderFormModel>('form', { required: true })

const props = defineProps<{
  editing: Provider | null
  saving: boolean
  definitions: ProviderDefinition[]
  labels: Record<string, string>
  providers: Provider[]
  errors: FieldErrors
}>()

const emit = defineEmits<{
  save: []
  'change-type': [type: string]
}>()

function fieldLabel(key: string) {
  return props.labels[key] || key
}

function isProviderSelectField(field: string) {
  return field === 'dnspod_provider' || field === 'cloudflare_provider' || field === 'cloudflare_dns_provider'
}

function selectFieldProviders(field: string): Provider[] {
  if (field === 'dnspod_provider') {
    return props.providers.filter((item) => item.type === 'dnspod' && item.configured)
  }
  if (field === 'cloudflare_provider' || field === 'cloudflare_dns_provider') {
    return props.providers.filter((item) => item.type === 'cloudflare' && item.configured)
  }
  return []
}

function selectFieldPlaceholder(field: string) {
  if (field === 'dnspod_provider') return '选择 DNSPod'
  if (field === 'cloudflare_provider') return '选择 Cloudflare'
  if (field === 'cloudflare_dns_provider') return '选择 Cloudflare DNS'
  return '请选择'
}

function dialogFields(): string[] {
  if (props.editing?.editable_fields?.length) return props.editing.editable_fields
  const def = props.definitions.find((item) => item.type === form.value.type)
  return def?.fields || []
}
</script>

<template>
  <AppDialog
    v-model:open="open"
    :title="editing ? `更新 ${editing.name}` : '新增服务商'"
    description="留空的字段不会覆盖现有配置；密钥留空表示不修改。"
  >
    <FieldGroup>
      <Field v-if="!editing" :data-invalid="!!errors.id">
        <FieldLabel>ID</FieldLabel>
        <Input v-model="form.id" placeholder="如 cloudflare-main" aria-describedby="provider-id-error" />
        <FieldError id="provider-id-error" :errors="fieldError(errors, 'id')" />
      </Field>
      <Field v-if="!editing" :data-invalid="!!errors.type">
        <FieldLabel>类型</FieldLabel>
        <Select :model-value="form.type" @update:model-value="(v) => emit('change-type', String(v || ''))">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="选择类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="item in definitions" :key="item.type" :value="item.type">
              {{ item.name || item.type }}
            </SelectItem>
          </SelectContent>
        </Select>
        <FieldError :errors="fieldError(errors, 'type')" />
      </Field>
      <Field :data-invalid="!!errors.name">
        <FieldLabel>名称</FieldLabel>
        <Input v-model="form.name" placeholder="显示名称" />
        <FieldError :errors="fieldError(errors, 'name')" />
      </Field>
      <Field v-for="field in dialogFields()" :key="field" :data-invalid="!!errors[field]">
        <FieldLabel>{{ fieldLabel(field) }}</FieldLabel>
        <Select v-if="isProviderSelectField(field)" v-model="form.fields[field]">
          <SelectTrigger class="w-full">
            <SelectValue :placeholder="selectFieldPlaceholder(field)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="item in selectFieldProviders(field)" :key="item.id" :value="item.id">
              {{ item.name }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Input
          v-else-if="isProviderSecretField(field)"
          v-model="form.fields[field]"
          type="password"
          autocomplete="new-password"
          :placeholder="editing?.fields?.[field] || '未配置（留空不改）'"
        />
        <Input v-else v-model="form.fields[field]" :placeholder="editing?.fields?.[field] || fieldLabel(field)" />
        <FieldError :errors="fieldError(errors, field)" />
      </Field>
    </FieldGroup>
    <template #footer>
      <Button variant="outline" @click="open = false">取消</Button>
      <LoadingButton :loading="saving" @click="emit('save')">保存</LoadingButton>
    </template>
  </AppDialog>
</template>
