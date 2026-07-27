<script setup lang="ts">
import { AppDialog } from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import type { Provider, Zone } from '@/shared/types'

export type HostnameFormModel = {
  hostname: string
  hostname_prefix: string
  sync_provider_id: string
  sync_zone: string
  custom_origin_server: string
  use_custom_origin_server: boolean
  preferred_domain: string
  auto_preferred: boolean
  method: string
  min_tls: string
  auto_sync: boolean
}

const open = defineModel<boolean>('open', { required: true })
const form = defineModel<HostnameFormModel>('form', { required: true })

const props = defineProps<{
  editing: boolean
  saving: boolean
  syncProviders: Provider[]
  syncZones: Zone[]
  preferredOptions: Array<{ domain: string }>
  originSuggestions: string[]
  originSuggestOpen: boolean
}>()

const emit = defineEmits<{
  save: []
  'update:originSuggestOpen': [value: boolean]
  pickOrigin: [value: string]
}>()

const filteredOriginSuggestions = () => {
  const q = form.value.custom_origin_server.trim().toLowerCase()
  if (!q) return props.originSuggestions
  return props.originSuggestions.filter((item) => item.toLowerCase().includes(q))
}
</script>

<template>
  <AppDialog
    v-model:open="open"
    :title="editing ? '编辑主机名' : '新增主机名'"
    description="创建/更新 Cloudflare for SaaS 自定义主机名。"
    content-class="sm:max-w-xl"
  >
    <FieldGroup>
      <template v-if="editing">
        <Field>
          <FieldLabel>主机名</FieldLabel>
          <Input v-model="form.hostname" disabled />
        </Field>
      </template>
      <template v-else>
        <Field v-if="syncProviders.length">
          <FieldLabel>同步服务商</FieldLabel>
          <Select v-model="form.sync_provider_id">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="选择同步服务商" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="item in syncProviders" :key="item.id" :value="item.id">
                {{ item.name }}（{{ item.type === 'dnspod' ? 'DNSPod' : 'Cloudflare' }}）
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div v-if="form.sync_provider_id" class="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel>主机名前缀</FieldLabel>
            <Input v-model="form.hostname_prefix" placeholder="如 app；留空表示根域名" />
          </Field>
          <Field>
            <FieldLabel>同步域名</FieldLabel>
            <Select v-model="form.sync_zone">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="选择域名" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="zone in syncZones" :key="String(zone.name)" :value="String(zone.name)">
                  {{ zone.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field v-if="!form.sync_provider_id">
          <FieldLabel>主机名</FieldLabel>
          <Input v-model="form.hostname" placeholder="www.example.com" />
        </Field>
      </template>

      <div class="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>DCV 认证</FieldLabel>
          <Select v-model="form.method">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="选择验证方式" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="txt">TXT 验证（推荐）</SelectItem>
              <SelectItem value="http">HTTP 验证</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>最低 TLS 版本</FieldLabel>
          <Select v-model="form.min_tls">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="TLS" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1.0">TLS 1.0</SelectItem>
              <SelectItem value="1.1">TLS 1.1</SelectItem>
              <SelectItem value="1.2">TLS 1.2</SelectItem>
              <SelectItem value="1.3">TLS 1.3</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field orientation="horizontal">
        <Switch v-model="form.use_custom_origin_server" />
        <FieldLabel>自定义源服务器</FieldLabel>
      </Field>
      <Field v-if="form.use_custom_origin_server" class="relative">
        <Input
          v-model="form.custom_origin_server"
          placeholder="输入或从已用源服务器选择，如 origin.example.com"
          autocomplete="off"
          @focus="emit('update:originSuggestOpen', true)"
          @input="emit('update:originSuggestOpen', true)"
          @keydown.escape="emit('update:originSuggestOpen', false)"
        />
        <div
          v-if="originSuggestOpen && filteredOriginSuggestions().length"
          class="bg-popover text-popover-foreground absolute top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border shadow-md"
          @mousedown.prevent
        >
          <button
            v-for="item in filteredOriginSuggestions()"
            :key="item"
            type="button"
            class="hover:bg-accent hover:text-accent-foreground flex w-full items-center px-3 py-2 text-left text-sm"
            @click="emit('pickOrigin', item)"
          >
            {{ item }}
          </button>
        </div>
      </Field>

      <Field orientation="horizontal">
        <Switch v-model="form.auto_preferred" />
        <FieldLabel>自动优选</FieldLabel>
      </Field>
      <Field v-if="form.auto_preferred">
        <FieldLabel>优选域名</FieldLabel>
        <Select v-model="form.preferred_domain">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="选择优选域名" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">不使用优选</SelectItem>
            <SelectItem v-for="item in preferredOptions" :key="item.domain" :value="item.domain">
              {{ item.domain }}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field orientation="horizontal">
        <Switch v-model="form.auto_sync" />
        <FieldLabel>同步写回 DNS</FieldLabel>
      </Field>
    </FieldGroup>
    <template #footer>
      <Button variant="outline" @click="open = false">取消</Button>
      <Button :loading="saving" @click="emit('save')">保存</Button>
    </template>
  </AppDialog>
</template>
