<script setup lang="ts">
import { AppDialog } from '@/shared/ui/dialog'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field'

const open = defineModel<boolean>('open', { required: true })
const form = defineModel<{ hostname: string; service: string; path: string }>('form', { required: true })

defineProps<{
  editing: boolean
  saving: boolean
  errors: Record<string, string>
}>()

const emit = defineEmits<{ save: [] }>()
</script>

<template>
  <AppDialog
    v-model:open="open"
    :title="editing ? '编辑路由' : '添加路由'"
    description="把公网 hostname 映射到本地服务。"
  >
    <FieldGroup>
      <Field :data-invalid="!!errors.hostname">
        <FieldLabel>Hostname</FieldLabel>
        <Input v-model="form.hostname" placeholder="app.example.com" />
        <FieldError :errors="errors.hostname ? [errors.hostname] : []" />
      </Field>
      <Field :data-invalid="!!errors.service">
        <FieldLabel>Service</FieldLabel>
        <Input v-model="form.service" placeholder="http://localhost:8080" />
        <FieldError :errors="errors.service ? [errors.service] : []" />
      </Field>
      <Field>
        <FieldLabel>Path（可选）</FieldLabel>
        <Input v-model="form.path" placeholder="/" />
      </Field>
    </FieldGroup>
    <template #footer>
      <Button variant="outline" @click="open = false">取消</Button>
      <LoadingButton :loading="saving" @click="emit('save')">{{ editing ? '保存' : '添加' }}</LoadingButton>
    </template>
  </AppDialog>
</template>
