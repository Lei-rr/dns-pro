<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { EllipsisVertical, Plus, RefreshCw } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableLoading,
} from '@/shared/ui/table'
import { providersApi } from '@/features/providers/api/providers'
import { loadProviders, replaceProvidersCache } from '@/features/providers/stores/providers'
import { providerTypeLabel } from '@/features/providers/lib/paths'
import type { Provider, ProviderDefinition } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { useListPage } from '@/shared/lib/use-list-page'
import { confirmDelete } from '@/shared/ui/confirm'
import ProviderFormDialog from '@/features/providers/components/ProviderFormDialog.vue'

const saving = ref(false)
const providers = ref<Provider[]>([])
const definitions = ref<ProviderDefinition[]>([])
const labels = ref<Record<string, string>>({})
const dialogOpen = ref(false)
const editing = ref<Provider | null>(null)
const form = reactive({
  type: 'dnspod',
  name: '',
  fields: {} as Record<string, string>,
})
const operatingId = ref('')
const typeFilter = ref('all')

const { loading, refreshing, runLoad, onRefresh, fail } = useListPage({
  pageSizeScope: 'providers',
  load: async () => {
    try {
      const [listRes, defRes] = await Promise.all([providersApi.list(), providersApi.definitions()])
      providers.value = listRes.data
      definitions.value = defRes.data.types
      labels.value = defRes.data.labels
      replaceProvidersCache(listRes.data.filter((item) => item.configured))
    } catch (error) {
      fail(error)
    }
  },
})

const currentDefinition = computed(() => definitions.value.find((item) => item.type === form.type) || null)
const filteredProviders = computed(() => {
  if (typeFilter.value === 'all') return providers.value
  return providers.value.filter((item) => item.type === typeFilter.value)
})

function fieldLabel(key: string) {
  return labels.value[key] || key
}

function isSecretField(field: string) {
  return /key|token|secret|password/i.test(field)
}

function isProviderSelectField(field: string) {
  return field === 'dnspod_provider' || field === 'cloudflare_provider' || field === 'cloudflare_dns_provider'
}

function selectFieldProviders(field: string): Provider[] {
  if (field === 'dnspod_provider') {
    return providers.value.filter((item) => item.type === 'dnspod' && item.configured)
  }
  if (field === 'cloudflare_provider' || field === 'cloudflare_dns_provider') {
    return providers.value.filter((item) => item.type === 'cloudflare' && item.configured)
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
  if (editing.value?.editable_fields?.length) return editing.value.editable_fields
  return currentDefinition.value?.fields || []
}

function resetFormFields(type: string) {
  form.type = type
  form.fields = {}
  const fields =
    definitions.value.find((item) => item.type === type)?.fields || []
  for (const field of fields) form.fields[field] = ''
}

function openCreate() {
  editing.value = null
  form.name = ''
  resetFormFields(definitions.value[0]?.type || 'dnspod')
  dialogOpen.value = true
}

function onCreateTypeChange(type: string) {
  if (editing.value) return
  resetFormFields(type)
}

function openEdit(record: Provider) {
  editing.value = record
  form.type = record.type
  form.name = record.name
  form.fields = {}
  // 编辑时密钥只回填「已配置」占位，提交空串表示不改
  for (const field of record.editable_fields?.length ? record.editable_fields : Object.keys(record.fields || {})) {
    if (isSecretField(field)) {
      form.fields[field] = ''
    } else {
      form.fields[field] = String(
        (record as any)[field] || record.fields?.[field] || '',
      )
    }
  }
  dialogOpen.value = true
}

function linkedProviderName(providerId: string) {
  const linked = providers.value.find((item) => item.id === providerId)
  if (!linked) return '未配置'
  return linked.name || providerTypeLabel(linked.type) || '已配置'
}

/** 新版：API 配置列不展示密钥/ID，只显示状态或关联名称 */
function configItems(provider: Provider): Array<{ key: string; value: string; ok?: boolean }> {
  if (provider.type === 'dnspod' || provider.type === 'cloudflare') {
    return [
      {
        key: 'api',
        value: provider.configured ? '已配置' : '未配置',
        ok: !!provider.configured,
      },
    ]
  }

  const items: Array<{ key: string; value: string; ok?: boolean }> = []
  const fields = (provider.fields || {}) as Record<string, string>
  const pick = (key: string) =>
    String((provider as any)[key] || fields[key] || '').trim()

  if (provider.type === 'edgeone') {
    const dnspod = pick('dnspod_provider')
    if (dnspod) items.push({ key: 'edgeone-dnspod', value: linkedProviderName(dnspod), ok: true })
  }

  if (provider.type === 'saas') {
    const cf = pick('cloudflare_provider')
    const dnspod = pick('dnspod_provider')
    const cfDns = pick('cloudflare_dns_provider')
    if (cf) items.push({ key: 'saas-cf', value: `SaaS：${linkedProviderName(cf)}`, ok: true })
    if (dnspod) items.push({ key: 'saas-dnspod', value: `DNSPod 同步：${linkedProviderName(dnspod)}`, ok: true })
    if (cfDns) items.push({ key: 'saas-cf-dns', value: `Cloudflare DNS 同步：${linkedProviderName(cfDns)}`, ok: true })
  }

  if (provider.type === 'cloudflared') {
    const cf = pick('cloudflare_provider')
    if (cf) items.push({ key: 'tunnel-cf', value: linkedProviderName(cf), ok: true })
  }

  if (items.length) return items
  return [
    {
      key: 'api',
      value: provider.configured ? '已配置' : '未配置',
      ok: !!provider.configured,
    },
  ]
}

async function save() {
  if (!form.name.trim()) {
    toast.warning('请填写服务商名称')
    return
  }
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
    }
    if (!editing.value) {
      payload.type = form.type
    }
    // 空字段不覆盖；密钥留空=不修改
    for (const [key, value] of Object.entries(form.fields)) {
      if (value == null) continue
      const text = String(value).trim()
      if (!text) continue
      payload[key] = text
    }
    if (editing.value) {
      await providersApi.update(editing.value.id, payload)
      toast.success('服务商已更新')
    } else {
      await providersApi.create(payload)
      toast.success('服务商已创建')
    }
    dialogOpen.value = false
    await runLoad()
    await loadProviders({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function testProvider(record: Provider) {
  operatingId.value = `${record.id}:test`
  try {
    await providersApi.test(record.id)
    toast.success(`${record.name} 测通成功`)
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    operatingId.value = ''
  }
}

async function removeProvider(record: Provider) {
  if (!(await confirmDelete(record.name))) return
  operatingId.value = `${record.id}:delete`
  try {
    await providersApi.remove(record.id)
    toast.success('已删除')
    await runLoad()
    await loadProviders({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    operatingId.value = ''
  }
}


onMounted(() => runLoad())
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader title="服务商" description="管理 DNS / EdgeOne / Tunnel 服务商配置。密钥不会明文回显。">
      <Button variant="outline" size="sm" :disabled="loading" @click="onRefresh()">
        <RefreshCw class="size-4" :class="refreshing && 'animate-spin'" />
        刷新
      </Button>
      <Button size="sm" @click="openCreate">
        <Plus class="size-4" />
        新增服务商
      </Button>
    </PageHeader>

    <!-- products-01 style toolbar + table -->
    <div class="flex w-full flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            :variant="typeFilter === 'all' ? 'default' : 'outline'"
            @click="typeFilter = 'all'"
          >
            全部
          </Button>
          <Button
            v-for="item in definitions"
            :key="item.type"
            size="sm"
            :variant="typeFilter === item.type ? 'default' : 'outline'"
            @click="typeFilter = item.type"
          >
            {{ item.name || item.type }}
          </Button>
        </div>
      </div>

      <TableLoading :loading="loading" :empty="!filteredProviders.length">
        <Table>
          <TableHeader class="bg-muted/50">
            <TableRow class="!border-0">
              <TableHead class="rounded-l-lg px-4">服务商</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>API 配置</TableHead>
              <TableHead class="rounded-r-lg w-12" />
            </TableRow>
          </TableHeader>
          <TableBody class="**:data-[slot=table-cell]:py-2.5">
            <TableRow v-if="!filteredProviders.length && !loading">
              <TableCell colspan="4" class="text-muted-foreground py-10 text-center">暂无服务商</TableCell>
            </TableRow>
            <TableRow v-for="record in filteredProviders" :key="record.id">
              <TableCell class="px-4">
                <div class="font-medium">{{ record.name }}</div>
                <div class="text-muted-foreground max-w-[220px] truncate text-sm">{{ record.id }}</div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{{ providerTypeLabel(record.type) }}</Badge>
              </TableCell>
              <TableCell>
                <div class="flex max-w-md flex-wrap gap-1.5">
                  <Badge
                    v-for="item in configItems(record)"
                    :key="item.key"
                    :variant="item.ok ? 'secondary' : 'outline'"
                    class="max-w-full truncate font-normal"
                    :title="item.value"
                  >
                    {{ item.value }}
                  </Badge>
                </div>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" class="size-8">
                      <EllipsisVertical class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      :disabled="operatingId === `${record.id}:test`"
                      @click="testProvider(record)"
                    >
                      测通
                    </DropdownMenuItem>
                    <DropdownMenuItem @click="openEdit(record)">更新</DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      :disabled="operatingId === `${record.id}:delete`"
                      @click="removeProvider(record)"
                    >
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableLoading>
    </div>

    <ProviderFormDialog
      v-model:open="dialogOpen"
      v-model:form="form"
      :editing="editing"
      :saving="saving"
      :definitions="definitions"
      :labels="labels"
      :providers="providers"
      @save="save"
      @change-type="onCreateTypeChange"
    />
  </div>
</template>
