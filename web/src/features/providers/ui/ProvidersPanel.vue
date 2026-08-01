<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { Plus, RefreshCw } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button, LoadingButton } from '@/shared/ui/button'
import ProviderFormDialog from './ProviderFormDialog.vue'
import ProvidersTable from './ProvidersTable.vue'
import { providersApi } from '../api/provider-api'
import { replaceProvidersCache } from '../model/store'
import type { Provider, ProviderDefinition } from '../model/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { serverFieldErrors, type FieldErrors } from '@/shared/lib/field-errors'
import { useListPage } from '@/shared/lib/use-list-page'
import { useRowBusy } from '@/shared/lib/row-busy'
import { confirmDelete } from '@/shared/ui/confirm'

const saving = ref(false)
const providers = ref<Provider[]>([])
const definitions = ref<ProviderDefinition[]>([])
const labels = ref<Record<string, string>>({})
const dialogOpen = ref(false)
const editing = ref<Provider | null>(null)
const form = reactive({
  id: '',
  type: 'dnspod',
  name: '',
  fields: {} as Record<string, string>,
})
const formErrors = ref<FieldErrors>({})
const { isBusy: isRowBusy, runBusy, reset: resetRowOperations } = useRowBusy()
const typeFilter = ref('all')
const definitionsError = ref('')

const { loading, refreshing, runLoad, onRefresh, fail } = useListPage({
  pageSizeScope: 'providers',
  load: async (options = {}) => {
    const [listResult, definitionsResult] = await Promise.allSettled([providersApi.list(), providersApi.definitions()])
    if (options.isLatest && !options.isLatest()) return false
    if (listResult.status === 'rejected') {
      fail(listResult.reason)
      return false
    }
    const listRes = listResult.value
    providers.value = listRes.data
    replaceProvidersCache(listRes.data.filter((item) => item.configured))
    if (definitionsResult.status === 'fulfilled') {
      const defRes = definitionsResult.value
      definitions.value = defRes.data.types
      labels.value = defRes.data.labels
      definitionsError.value = ''
    } else {
      definitionsError.value = '服务商定义加载失败。'
      return false
    }
    return true
  },
})

const filteredProviders = computed(() => {
  if (typeFilter.value === 'all') return providers.value
  return providers.value.filter((item) => item.type === typeFilter.value)
})

function isSecretField(field: string) {
  return /key|token|secret|password/i.test(field)
}

function resetFormFields(type: string) {
  form.type = type
  form.fields = {}
  const fields = definitions.value.find((item) => item.type === type)?.fields || []
  for (const field of fields) form.fields[field] = ''
}

function openCreate() {
  if (definitionsError.value || !definitions.value.length) return
  editing.value = null
  form.id = ''
  form.name = ''
  formErrors.value = {}
  resetFormFields(definitions.value[0]?.type || 'dnspod')
  dialogOpen.value = true
}

function onCreateTypeChange(type: string) {
  if (editing.value) return
  resetFormFields(type)
}

function openEdit(record: Provider) {
  if (isRowBusy(record.id) || definitionsError.value || !definitions.value.length) return
  editing.value = record
  form.id = record.id
  form.type = record.type
  formErrors.value = {}
  form.name = record.name
  form.fields = {}
  // 编辑时密钥只回填「已配置」占位，提交空串表示不改
  for (const field of record.editable_fields?.length ? record.editable_fields : Object.keys(record.fields || {})) {
    if (isSecretField(field)) {
      form.fields[field] = ''
    } else {
      form.fields[field] = String(record[field] || record.fields?.[field] || '')
    }
  }
  dialogOpen.value = true
}

async function save() {
  const errors: FieldErrors = {}
  if (!editing.value && !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(form.id.trim()))
    errors.id = '请输入合法 ID（字母或数字开头，可含 _ 和 -）'
  if (!form.type) errors.type = '请选择服务商类型'
  if (!form.name.trim()) errors.name = '请填写服务商名称'
  formErrors.value = errors
  if (Object.keys(errors).length) return
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
    }
    if (!editing.value) {
      payload.id = form.id.trim()
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
  } catch (error) {
    formErrors.value = { ...formErrors.value, ...serverFieldErrors(error) }
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function testProvider(record: Provider) {
  await runBusy(record.id, async (owner) => {
    try {
      await providersApi.test(record.id)
      if (!owner.active()) return
      toast.success(`${record.name} 测通成功`)
    } catch (error) {
      if (owner.active()) toast.error(errorMessage(error))
    }
  })
}

async function removeProvider(record: Provider) {
  if (isRowBusy(record.id) || !(await confirmDelete(record.name))) return
  await runBusy(record.id, async (owner) => {
    try {
      await providersApi.remove(record.id)
      if (!owner.active()) return
      toast.success('已删除')
      await runLoad()
    } catch (error) {
      if (owner.active()) toast.error(errorMessage(error))
    }
  })
}

onMounted(() => runLoad())
onUnmounted(resetRowOperations)
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader title="服务商" description="管理 DNS / EdgeOne / Tunnel 服务商配置。密钥不会明文回显。">
      <LoadingButton
        variant="outline"
        size="sm"
        :loading="refreshing"
        :disabled="loading && !refreshing"
        @click="onRefresh()"
      >
        <RefreshCw class="size-4" />
        刷新
      </LoadingButton>
      <Button size="sm" :disabled="!!definitionsError || !definitions.length" @click="openCreate">
        <Plus class="size-4" />
        新增服务商
      </Button>
    </PageHeader>

    <div v-if="definitionsError" role="alert" class="text-destructive flex items-center gap-2 text-sm">
      <span>{{ definitionsError }}</span>
      <Button type="button" variant="link" size="sm" class="text-destructive h-auto p-0" @click="onRefresh()"
        >重试</Button
      >
    </div>

    <!-- products-01 style toolbar + table -->
    <div class="flex w-full flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" :variant="typeFilter === 'all' ? 'default' : 'outline'" @click="typeFilter = 'all'">
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

      <ProvidersTable
        :providers="filteredProviders"
        :all-providers="providers"
        :loading="loading"
        :refreshing="refreshing"
        :can-edit="!definitionsError && !!definitions.length"
        :busy="(record) => isRowBusy(record.id)"
        @test="testProvider"
        @edit="openEdit"
        @remove="removeProvider"
      />
    </div>

    <ProviderFormDialog
      v-model:open="dialogOpen"
      v-model:form="form"
      :editing="editing"
      :saving="saving"
      :definitions="definitions"
      :labels="labels"
      :providers="providers"
      :errors="formErrors"
      @save="save"
      @change-type="onCreateTypeChange"
    />
  </div>
</template>
