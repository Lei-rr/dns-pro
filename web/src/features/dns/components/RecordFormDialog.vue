<script setup lang="ts">
import { AppDialog } from '@/shared/ui/dialog'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Checkbox } from '@/shared/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { fieldError, type FieldErrors } from '@/shared/lib/field-errors'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

export type RecordFormModel = {
  name: string
  type: string
  value: string
  ttl: string
  line: string
  remark: string
  priority: string
  proxied: boolean
}

const open = defineModel<boolean>('open', { required: true })
const form = defineModel<RecordFormModel>('form', { required: true })

defineProps<{
  editing: boolean
  saving: boolean
  isCloudflare: boolean
  typeOptions: string[]
  lineOptions: Array<{ label: string; value: string }>
  errors: FieldErrors
}>()

const emit = defineEmits<{
  save: []
}>()
</script>

<template>
  <AppDialog
    v-model:open="open"
    :title="editing ? '编辑解析记录' : '添加解析记录'"
    :description="editing ? '修改当前记录字段。' : '支持空格/逗号分隔多个主机记录，一次创建多条。'"
  >
    <FieldGroup>
      <Field :data-invalid="!!errors.name">
        <FieldLabel>主机记录</FieldLabel>
        <Input
          v-model="form.name"
          :placeholder="editing ? '例如 www 或 @' : '例如 www 或 @，多个用空格/逗号分隔'"
        />
        <FieldError :errors="fieldError(errors, 'name')" />
      </Field>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field :data-invalid="!!errors.type">
          <FieldLabel>类型</FieldLabel>
          <Select v-model="form.type">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="item in typeOptions" :key="item" :value="item">{{ item }}</SelectItem>
            </SelectContent>
          </Select>
          <FieldError :errors="fieldError(errors, 'type')" />
        </Field>
        <Field :data-invalid="!!errors.ttl">
          <FieldLabel>TTL</FieldLabel>
          <Input v-model="form.ttl" :placeholder="isCloudflare ? '1=自动' : '600'" />
          <FieldError :errors="fieldError(errors, 'ttl')" />
        </Field>
      </div>
      <Field :data-invalid="!!errors.value">
        <FieldLabel>记录值</FieldLabel>
        <Input v-model="form.value" placeholder="IP / 域名 / 文本" />
        <FieldError :errors="fieldError(errors, 'value')" />
      </Field>
      <Field v-if="!isCloudflare">
        <FieldLabel>线路</FieldLabel>
        <Select v-model="form.line">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="选择线路" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="item in lineOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field v-if="form.type === 'MX'">
        <FieldLabel>MX 优先级</FieldLabel>
        <Input v-model="form.priority" type="number" min="0" max="65535" placeholder="10" />
      </Field>
      <Field v-if="isCloudflare" orientation="horizontal">
        <Checkbox id="proxied" v-model="form.proxied" />
        <FieldLabel for="proxied">启用代理</FieldLabel>
      </Field>
      <Field>
        <FieldLabel>备注</FieldLabel>
        <Input v-model="form.remark" placeholder="可选" />
      </Field>
    </FieldGroup>
    <template #footer>
      <Button variant="outline" @click="open = false">取消</Button>
      <LoadingButton :loading="saving" @click="emit('save')">保存</LoadingButton>
    </template>
  </AppDialog>
</template>
