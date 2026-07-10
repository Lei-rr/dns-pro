<template>
  <section>
    <div class="page-toolbar">
      <div>
        <a-typography-title :level="3" style="margin-bottom: 4px">服务商</a-typography-title>
        <a-typography-text type="secondary">管理 DNS 和 EdgeOne 服务商配置。已保存的密钥不会明文显示。</a-typography-text>
      </div>
      <div class="page-actions">
        <a-button type="primary" @click="openCreate">新增服务商</a-button>
        <a-button :loading="loading" @click="load">刷新</a-button>
      </div>
    </div>
    <a-table
      :data-source="providers"
      :row-key="provider => provider.id"
      :loading="loading"
      :pagination="false"
      :columns="[
        { title: '排序', key: 'sort', width: 64 },
        { title: '服务商', key: 'name', width: 280 },
        { title: 'API 配置', key: 'fields', width: 420 },
        { title: '操作', key: 'actions', width: 150, align: 'right' },
      ]"
      size="middle"
      :scroll="{ x: 920 }"
      :custom-row="providerRowProps"
      :locale="{ emptyText: '暂无服务商配置' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'sort'">
          <a-typography-text type="secondary" style="cursor: grab" title="拖动调整顺序" v-bind="sortHandleProps(record)">☰</a-typography-text>
        </template>
        <template v-else-if="column.key === 'name'">
          <a-space>
            <a-tag>{{ providerDefinition(record.type)?.name || record.type }}</a-tag>
            <span>{{ record.name }}</span>
            <a-typography-text type="secondary">{{ record.id }}</a-typography-text>
          </a-space>
        </template>
        <template v-else-if="column.key === 'fields'">
          <a-space direction="vertical" size="small" style="width: 100%">
            <div v-for="item in configItems(record)" :key="item.key" style="display: flex; align-items: flex-start; justify-content: flex-start; gap: 8px; flex-wrap: wrap">
              <a-tag :color="item.color" style="margin-inline-end: 0">{{ item.value }}</a-tag>
            </div>
          </a-space>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space size="small">
            <a-button type="link" size="small" :disabled="!!providerOperation" @click="edit(record)">更新</a-button>
            <a-button type="link" size="small" danger :loading="providerOperationLoading(record.id, 'delete')" :disabled="!!providerOperation" @click="askDelete(record)">删除</a-button>
          </a-space>
        </template>
      </template>
    </a-table>
    <a-modal :open="!!editing" :title="editing ? '更新 ' + editing.name + ' 服务商配置' : ''" :confirm-loading="saving" ok-text="保存" cancel-text="取消" @ok="save" @cancel="editing = null" @update:open="open => { if (!open) editing = null }">
      <a-alert type="info" show-icon style="margin-bottom: 16px" message="留空的字段不会覆盖现有配置；如需清空请使用清除。" />
      <a-form v-if="editing" layout="vertical">
        <a-form-item label="配置标识">
          <a-input :value="editing.id" disabled />
        </a-form-item>
        <a-form-item label="显示名称">
          <a-input v-model:value="form.name" placeholder="留空使用默认名称" />
        </a-form-item>
        <a-form-item v-for="field in editing.editable_fields" :key="field" :label="fieldLabel(field)">
          <a-select v-if="isProviderSelectField(field)" v-model:value="form[field]" :placeholder="selectFieldPlaceholder(field)">
            <a-select-option v-for="provider in selectFieldProviders(field)" :key="provider.id" :value="provider.id">{{ provider.name }}（{{ provider.id }}）</a-select-option>
          </a-select>
          <a-input-password v-else-if="isSecretField(field)" v-model:value="form[field]" :placeholder="editing.fields[field] || '未配置'" />
          <a-input v-else v-model:value="form[field]" :placeholder="editing.fields[field] || '未配置'" />
        </a-form-item>
      </a-form>
    </a-modal>
    <a-modal v-model:open="creating" title="新增服务商" :confirm-loading="saving" ok-text="保存" cancel-text="取消" @ok="create">
      <a-form layout="vertical">
        <a-form-item label="类型" required>
          <a-select :value="createForm.type" @change="onCreateTypeChange">
            <a-select-option v-for="providerType in providerTypes" :key="providerType.type" :value="providerType.type">{{ providerType.name }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="配置标识" required>
          <a-input v-model:value="createForm.id" placeholder="例如 dnspod-main / dnspod-work" />
          <a-typography-text type="secondary">用于区分多个账号，也会作为访问路径；只能用字母、数字、-、_，不能使用 home、login、providers、user</a-typography-text>
        </a-form-item>
        <a-form-item label="显示名称">
          <a-input v-model:value="createForm.name" placeholder="留空使用默认名称" />
        </a-form-item>
        <a-form-item v-for="field in createFields()" :key="field" :label="fieldLabel(field)" :required="requiredFields(createForm.type).includes(field)">
          <a-select v-if="isProviderSelectField(field)" v-model:value="createForm[field]" :placeholder="selectFieldPlaceholder(field)">
            <a-select-option v-for="provider in selectFieldProviders(field)" :key="provider.id" :value="provider.id">{{ provider.name }}（{{ provider.id }}）</a-select-option>
          </a-select>
          <a-input-password v-else-if="isSecretField(field)" v-model:value="createForm[field]" />
          <a-input v-else v-model:value="createForm[field]" />
        </a-form-item>
      </a-form>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, h, onMounted } from 'vue'
import { providerSettingsApi } from '@/modules/provider/api/providers'
import { replaceProvidersCache } from '@/stores/providers'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'
import type { Provider, ProviderDefinition } from '@/types'

const providers = ref<Provider[]>([])
const editing = ref<Provider | null>(null)
const creating = ref(false)
const form = ref<Record<string, string>>({})
const createForm = ref<Record<string, string>>({ id: '', name: '', type: 'dnspod' })
const loading = ref(true)
const saving = ref(false)
const sortSaving = ref(false)
const draggingProvider = ref('')
const providerOperation = ref<{ providerId: string; action: string } | null>(null)
const providerDefinitions = ref<{ types: ProviderDefinition[]; labels: Record<string, string> } | null>(null)
let loadRequestToken = 0
let definitionLoadRequestToken = 0

const dnspodProviders = computed(() => providers.value.filter((provider) => provider.type === 'dnspod' && provider.configured))
const cloudflareProviders = computed(() => providers.value.filter((provider) => provider.type === 'cloudflare' && provider.configured))
const providerTypes = computed(() => providerDefinitions.value?.types || [])

onMounted(async () => {
  await loadProviderDefinitions()
  await load()
})

async function loadProviderDefinitions() {
  const requestToken = definitionLoadRequestToken + 1
  definitionLoadRequestToken = requestToken

  try {
    const definitions = (await providerSettingsApi.providerDefinitions()).data
    if (requestToken !== definitionLoadRequestToken) return
    providerDefinitions.value = definitions
  } catch {
    if (requestToken !== definitionLoadRequestToken) return
    providerDefinitions.value = null
  }
}

async function load() {
  const requestToken = loadRequestToken + 1
  loadRequestToken = requestToken
  loading.value = true

  try {
    const list = (await providerSettingsApi.providers()).data
    if (requestToken !== loadRequestToken) return
    providers.value = list
    replaceProvidersCache(list)
  } catch (error) {
    if (requestToken !== loadRequestToken) return
    message.error(errorMessage(error))
  } finally {
    if (requestToken === loadRequestToken) loading.value = false
  }
}

function edit(provider: Provider) {
  editing.value = provider
  form.value = Object.fromEntries(
    [['name', editNameValue(provider)], ...provider.editable_fields.map((field) => [field, editFieldValue(provider, field)])],
  )
}

function openCreate() {
  createForm.value = { id: '', name: '', type: 'dnspod' }
  creating.value = true
}

function onCreateTypeChange(type: string) {
  const fields = createFields(type)
  const next: Record<string, string> = { id: createForm.value.id, name: createForm.value.name, type }
  for (const field of fields) {
    next[field] = defaultSelectFieldValue(field)
  }
  createForm.value = next
}

function createFields(type = createForm.value.type): string[] {
  return providerDefinition(type)?.fields || []
}

function moveProvider(sourceId: string, targetId: string) {
  const sourceIndex = providers.value.findIndex((provider) => provider.id === sourceId)
  const targetIndex = providers.value.findIndex((provider) => provider.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return providers.value

  const next = [...providers.value]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

function sortHandleProps(record: Provider) {
  return {
    draggable: !sortSaving.value,
    onDragstart: (event: DragEvent) => {
      draggingProvider.value = record.id
      event.dataTransfer!.effectAllowed = 'move'
      event.dataTransfer!.setData('text/plain', record.id)

      const row = (event.currentTarget as HTMLElement).closest('tr')
      if (row) event.dataTransfer!.setDragImage(row, 0, Math.floor(row.offsetHeight / 2))
    },
    onDragend: () => { draggingProvider.value = '' },
  }
}

function providerRowProps(record: Provider) {
  return {
    class: draggingProvider.value === record.id ? 'provider-sort-row-dragging' : '',
    onDragover: (event: DragEvent) => {
      if (!draggingProvider.value || sortSaving.value) return
      event.preventDefault()
      event.dataTransfer!.dropEffect = 'move'
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      dropProvider(record.id)
    },
  }
}

async function dropProvider(targetId: string) {
  const sourceId = draggingProvider.value
  if (!sourceId || sourceId === targetId || sortSaving.value) return

  const previous = [...providers.value]
  const next = moveProvider(sourceId, targetId)
  if (next === providers.value) return
  providers.value = next
  sortSaving.value = true
  try {
    const response = await providerSettingsApi.updateProviderOrder(next.map((provider) => provider.id))
    providers.value = response.data
    replaceProvidersCache(providers.value)
    message.success('API 顺序已保存')
  } catch (error) {
    providers.value = previous
    message.error(errorMessage(error))
  } finally {
    sortSaving.value = false
    draggingProvider.value = ''
  }
}

async function create() {
  saving.value = true
  try {
    const fields = createFields()
    const reserved = ['home', 'login', 'providers', 'user']
    const id = createForm.value.id.trim().toLowerCase()
    if (!id) {
      message.warning('请输入配置标识')
      return
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
      message.warning('配置标识格式不正确')
      return
    }
    if (reserved.includes(id)) {
      message.warning('配置标识不能使用系统路由名称')
      return
    }
    const payload: Record<string, string> = {
      id,
      name: createForm.value.name.trim(),
      type: createForm.value.type,
    }
    for (const field of fields) {
      let value = String(createForm.value[field] || '').trim()
      if (value === '' && isProviderSelectField(field)) {
        const candidates = selectFieldProviders(field)
        if (candidates.length === 1) value = candidates[0].id
      }
      payload[field] = value
    }
    const missing = requiredFields(createForm.value.type).find((field) => !payload[field])
    if (missing) {
      const hint = isProviderSelectField(missing) && selectFieldProviders(missing).length === 0
        ? `请先创建并配置一个${selectFieldPlaceholder(missing).replace('选择', '')}`
        : `${fieldLabel(missing)} 不能为空`
      message.warning(hint)
      return
    }
    await providerSettingsApi.createProvider(payload)
    message.success('服务商已添加')
    creating.value = false
    await load()
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function save() {
  if (!editing.value) return
  saving.value = true
  try {
    const payload: Record<string, string> = {
      name: String(form.value.name ?? '').trim(),
      ...Object.fromEntries(editing.value.editable_fields
        .map((field) => [field, String(form.value[field] ?? '').trim()])),
    }
    if (!Object.keys(payload).length) {
      message.warning('请输入要更新的配置')
      return
    }
    await providerSettingsApi.updateProvider(editing.value.id, payload)
    message.success('配置已保存')
    editing.value = null
    await load()
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

function askDelete(provider: Provider) {
  const dependencies = providerReferenceDependencies(provider)
  const content = dependencies.length
    ? h('div', { style: 'white-space: pre-wrap' }, `确认删除 ${provider.name}（${provider.id}）？删除后该服务商配置会被移除。\n\n依赖关系：\n${dependencies.map((item) => `- ${dependencyLabel(item)}`).join('\n')}\n\n请先修改或删除上述关联配置。`)
    : `确认删除 ${provider.name}（${provider.id}）？删除后该服务商配置会被移除。`
  modal.confirm({
    title: '删除服务商配置',
    content,
    okText: '删除',
    okType: 'danger',
    okButtonProps: { disabled: dependencies.length > 0 },
    cancelText: '取消',
    onOk: () => remove(provider),
  })
}

async function remove(provider: Provider) {
  if (providerOperation.value) return
  providerOperation.value = { providerId: provider.id, action: 'delete' }
  try {
    await providerSettingsApi.deleteProvider(provider.id)
    message.success('服务商配置已删除')
    await load()
  } catch (error) {
    const e = error as { code?: string; details?: { dependencies?: Array<{ reason?: string; name?: string; id?: string }> } }
    if (e.code === 'provider_in_use' && Array.isArray(e.details?.dependencies)) {
      showProviderDependencies(provider, e.details.dependencies)
      return
    }
    message.error(errorMessage(error))
  } finally {
    providerOperation.value = null
  }
}

function providerOperationLoading(providerId: string, action: string) {
  return providerOperation.value?.providerId === providerId && providerOperation.value?.action === action
}

function providerReferenceDependencies(provider: Provider) {
  return Array.isArray(provider.dependencies) ? provider.dependencies : []
}

function dependencyLabel(item: { reason?: string; name?: string; id?: string }) {
  const reason = String(item?.reason || '').trim()
  const name = String(item?.name || '').trim()
  const id = String(item?.id || '').trim()
  return `${reason || '引用'}：${name || '-'}${id ? `（${id}）` : ''}`
}

function showProviderDependencies(provider: Provider, dependencies: Array<{ reason?: string; name?: string; id?: string }>) {
  modal.warning({
    title: '服务商仍在使用中',
    content: h('div', { style: 'white-space: pre-wrap' }, `无法删除 ${provider.name}（${provider.id}）。\n\n依赖关系：\n${dependencies.map((item) => `- ${dependencyLabel(item)}`).join('\n')}`),
    okText: '知道了',
  })
}

function fieldLabel(field: string) {
  return providerDefinitions.value?.labels?.[field] || field
}

function editFieldValue(provider: Provider, field: string) {
  if (isSecretField(field)) return ''
  if (!isProviderSelectField(field)) return (provider[field] as string) || ''
  return defaultSelectFieldValue(field, (provider[field] as string) || '')
}

function editNameValue(provider: Provider) {
  const definition = providerDefinition(provider.type)
  const current = String(provider.name || '')
  return current === String(definition?.name || '') ? '' : current
}

function defaultSelectFieldValue(field: string, currentValue = '') {
  if (!isProviderSelectField(field)) return currentValue
  return currentValue || selectFieldProviders(field)[0]?.id || ''
}

function requiredFields(type: string): string[] {
  return providerDefinition(type)?.required || []
}

function providerDefinition(type: string): ProviderDefinition | null {
  return providerDefinitions.value?.types.find((providerType) => providerType.type === type) || null
}

function isProviderSelectField(field: string) {
  return field === 'dnspod_provider' || field === 'cloudflare_provider'
}

function selectFieldProviders(field: string): Provider[] {
  if (field === 'dnspod_provider') return dnspodProviders.value
  if (field === 'cloudflare_provider') return cloudflareProviders.value
  return []
}

function selectFieldPlaceholder(field: string) {
  if (field === 'dnspod_provider') return '选择 DNSPod API'
  if (field === 'cloudflare_provider') return '选择 Cloudflare API'
  return '请选择'
}

function isSecretField(field: string) {
  return field.includes('key') || field.includes('token')
}

function linkedProviderLabel(providerId: string) {
  const linked = providers.value.find((provider) => provider.id === providerId)
  if (!linked) return providerId || '未配置'
  return `${linked.name}（${linked.id}）`
}

function configItems(provider: Provider): Array<{ key: string; value: string; color: string }> {
  if (provider.type === 'dnspod' || provider.type === 'cloudflare') {
    return [{
      key: 'api',
      value: provider.configured ? '已配置' : '未配置',
      color: provider.configured ? 'green' : 'default',
    }]
  }

  const items: Array<{ key: string; value: string; color: string }> = []

  if (provider.type === 'edgeone' && provider.dnspod_provider) {
    items.push({
      key: 'edgeone-dnspod',
      value: linkedProviderLabel(provider.dnspod_provider),
      color: 'blue',
    })
  }

  if (provider.type === 'saas' && provider.cloudflare_provider) {
    items.push({
      key: 'saas-cloudflare',
      value: linkedProviderLabel(provider.cloudflare_provider),
      color: 'orange',
    })
  }

  if (provider.type === 'cloudflared' && provider.cloudflare_provider) {
    items.push({
      key: 'cloudflared-cloudflare',
      value: linkedProviderLabel(provider.cloudflare_provider),
      color: 'orange',
    })
  }

  return items.length ? items : [{
    key: 'api',
    value: provider.configured ? '已配置' : '未配置',
    color: provider.configured ? 'green' : 'default',
  }]
}
</script>
