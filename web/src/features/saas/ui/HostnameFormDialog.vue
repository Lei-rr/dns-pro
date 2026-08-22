<script setup lang="ts">
import { computed, ref } from 'vue'
import { AppDialog } from '@/shared/ui/dialog'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field'
import type { FieldErrors } from '@/shared/lib/field-errors'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import type { DnsZoneOption, SaaSSyncProvider } from '../model/types'

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
  syncProviders: SaaSSyncProvider[]
  syncZones: DnsZoneOption[]
  preferredOptions: Array<{ domain: string }>
  originSuggestions: string[]
  errors: FieldErrors
  syncZonesError?: string
  preferredOptionsError?: string
}>()

const emit = defineEmits<{
  save: []
  retrySyncZones: []
  retryPreferredOptions: []
}>()

const showOriginDropdown = ref(false)

const filteredOriginSuggestions = computed(() => {
  const query = form.value.custom_origin_server.trim().toLowerCase()
  if (!query) return props.originSuggestions
  return props.originSuggestions.filter((item) => item.toLowerCase().includes(query))
})

function selectOrigin(item: string) {
  form.value.custom_origin_server = item
  showOriginDropdown.value = false
}

function onOriginBlur() {
  setTimeout(() => {
    showOriginDropdown.value = false
  }, 200)
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
        <div v-if="form.sync_provider_id" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel>主机名前缀</FieldLabel>
            <Input v-model="form.hostname_prefix" placeholder="如 app；留空表示根域名" />
          </Field>
          <Field :data-invalid="!!errors.hostname">
            <FieldLabel>同步域名</FieldLabel>
            <Select v-model="form.sync_zone">
              <SelectTrigger class="w-full" :disabled="!!syncZonesError">
                <SelectValue placeholder="选择域名" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="zone in syncZones" :key="String(zone.name)" :value="String(zone.name)">
                  {{ zone.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldError v-if="syncZonesError" class="flex items-center gap-1.5">
              <span>{{ syncZonesError }}</span>
              <Button
                type="button"
                variant="link"
                size="sm"
                class="text-destructive h-auto p-0"
                @click="emit('retrySyncZones')"
                >重试</Button
              >
            </FieldError>
            <FieldError :errors="errors.hostname ? [errors.hostname] : []" />
          </Field>
        </div>
        <Field v-if="!form.sync_provider_id" :data-invalid="!!errors.hostname">
          <FieldLabel>主机名</FieldLabel>
          <Input v-model="form.hostname" placeholder="www.example.com" />
          <FieldError :errors="errors.hostname ? [errors.hostname] : []" />
        </Field>
      </template>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      <Field v-if="form.use_custom_origin_server" :data-invalid="!!errors.custom_origin_server">
        <div class="relative w-full">
          <Input
            v-model="form.custom_origin_server"
            placeholder="输入或从已用源服务器选择，如 origin.example.com"
            autocomplete="off"
            @focus="showOriginDropdown = true"
            @blur="onOriginBlur"
          />
          <div
            v-if="showOriginDropdown && filteredOriginSuggestions.length"
            class="bg-popover text-popover-foreground absolute top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border p-1 shadow-md"
          >
            <div
              v-for="item in filteredOriginSuggestions"
              :key="item"
              class="hover:bg-accent hover:text-accent-foreground flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none"
              @mousedown.prevent="selectOrigin(item)"
            >
              {{ item }}
            </div>
          </div>
        </div>
        <FieldError :errors="errors.custom_origin_server ? [errors.custom_origin_server] : []" />
      </Field>

      <Field orientation="horizontal">
        <Switch v-model="form.auto_preferred" />
        <FieldLabel>自动优选</FieldLabel>
      </Field>
      <Field v-if="form.auto_preferred" :data-invalid="!!errors.preferred_domain">
        <FieldLabel>优选域名</FieldLabel>
        <Select v-model="form.preferred_domain">
          <SelectTrigger class="w-full" :disabled="!!preferredOptionsError">
            <SelectValue placeholder="选择优选域名" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">不使用优选</SelectItem>
            <SelectItem v-for="item in preferredOptions" :key="item.domain" :value="item.domain">
              {{ item.domain }}
            </SelectItem>
          </SelectContent>
        </Select>
        <FieldError v-if="preferredOptionsError" class="flex items-center gap-1.5">
          <span>{{ preferredOptionsError }}</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            class="text-destructive h-auto p-0"
            @click="emit('retryPreferredOptions')"
            >重试</Button
          >
        </FieldError>
        <FieldError :errors="errors.preferred_domain ? [errors.preferred_domain] : []" />
      </Field>

      <Field orientation="horizontal">
        <Switch v-model="form.auto_sync" />
        <FieldLabel>同步写回 DNS</FieldLabel>
      </Field>
    </FieldGroup>
    <template #footer>
      <Button variant="outline" @click="open = false">取消</Button>
      <LoadingButton :loading="saving" @click="emit('save')">保存</LoadingButton>
    </template>
  </AppDialog>
</template>
