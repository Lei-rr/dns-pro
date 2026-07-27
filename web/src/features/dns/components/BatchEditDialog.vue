<script setup lang="ts">
import { AppDialog } from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

export type BatchPatchModel = {
  value: string
  ttl: string
  line: string
  remark: string
  priority: string
  proxied: '__keep' | 'true' | 'false'
}

const open = defineModel<boolean>('open', { required: true })
const patch = defineModel<BatchPatchModel>('patch', { required: true })

defineProps<{
  selectedCount: number
  isCloudflare: boolean
  lineOptions: Array<{ label: string; value: string }>
}>()

const emit = defineEmits<{
  submit: []
}>()
</script>

<template>
  <AppDialog
    v-model:open="open"
    title="批量修改记录"
    :description="`仅填写需要改的字段，将应用到已选 ${selectedCount} 条记录。`"
  >
    <FieldGroup>
      <Field>
        <FieldLabel>记录值</FieldLabel>
        <Input v-model="patch.value" placeholder="留空不改" />
      </Field>
      <div :class="isCloudflare ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-2 gap-3'">
        <Field v-if="!isCloudflare">
          <FieldLabel>TTL</FieldLabel>
          <Input v-model="patch.ttl" placeholder="留空不改" />
        </Field>
        <Field v-if="!isCloudflare">
          <FieldLabel>线路</FieldLabel>
          <Select v-model="patch.line">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="留空不改" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__keep">不改</SelectItem>
              <SelectItem v-for="item in lineOptions" :key="item.value" :value="item.value">
                {{ item.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field>
        <FieldLabel>备注</FieldLabel>
        <Input v-model="patch.remark" placeholder="留空不改" />
      </Field>
      <Field v-if="isCloudflare">
        <FieldLabel>代理</FieldLabel>
        <Select v-model="patch.proxied">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="代理设置" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__keep">不改</SelectItem>
            <SelectItem value="true">开启代理</SelectItem>
            <SelectItem value="false">仅 DNS</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>MX 优先级</FieldLabel>
        <Input v-model="patch.priority" placeholder="留空不改" />
      </Field>
    </FieldGroup>
    <template #footer>
      <Button variant="outline" @click="open = false">取消</Button>
      <Button @click="emit('submit')">开始修改</Button>
    </template>
  </AppDialog>
</template>
