import { ref, h } from 'vue'
import { providerSettingsApi } from '@/modules/provider/api/providers'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'
import type { Provider, ProviderDefinition } from '@/types'

export function useProviderCrud({
  load,
  providerDefinition,
  fieldLabel,
  requiredFields,
  isProviderSelectField,
  isSecretField,
  selectFieldProviders,
  selectFieldPlaceholder,
  createFields,
}: {
  load: () => Promise<void>
  providerDefinition: (type: string) => ProviderDefinition | null
  fieldLabel: (field: string) => string
  requiredFields: (type: string) => string[]
  isProviderSelectField: (field: string) => boolean
  isSecretField: (field: string) => boolean
  selectFieldProviders: (field: string) => Provider[]
  selectFieldPlaceholder: (field: string) => string
  createFields: (type?: string) => string[]
}) {
  const editing = ref<Provider | null>(null)
  const creating = ref(false)
  const form = ref<Record<string, string>>({})
  const createForm = ref<Record<string, string>>({ id: '', name: '', type: 'dnspod' })
  const saving = ref(false)
  const providerOperation = ref<{ providerId: string; action: string } | null>(null)

  function handleEditOpenChange(open: boolean) {
    if (!open) editing.value = null
  }

  function edit(provider: Provider) {
    editing.value = provider
    form.value = Object.fromEntries([
      ['name', editNameValue(provider)],
      ...provider.editable_fields.map((field) => [field, editFieldValue(provider, field)]),
    ])
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

  function defaultSelectFieldValue(field: string, currentValue = '') {
    if (!isProviderSelectField(field)) return currentValue
    return currentValue || selectFieldProviders(field)[0]?.id || ''
  }

  function editNameValue(provider: Provider) {
    const definition = providerDefinition(provider.type)
    const current = String(provider.name || '')
    return current === String(definition?.name || '') ? '' : current
  }

  function editFieldValue(provider: Provider, field: string) {
    if (isSecretField(field)) return ''
    if (!isProviderSelectField(field)) return (provider[field] as string) || ''
    return defaultSelectFieldValue(field, (provider[field] as string) || '')
  }

  async function create() {
    saving.value = true
    try {
      const fields = createFields(createForm.value.type)
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
        const hint =
          isProviderSelectField(missing) && selectFieldProviders(missing).length === 0
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
        ...Object.fromEntries(
          editing.value.editable_fields.map((field) => [field, String(form.value[field] ?? '').trim()])
        ),
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
      ? h(
          'div',
          { style: 'white-space: pre-wrap' },
          `确认删除 ${provider.name}（${provider.id}）？删除后该服务商配置会被移除。\n\n依赖关系：\n${dependencies.map((item) => `- ${dependencyLabel(item)}`).join('\n')}\n\n请先修改或删除上述关联配置。`
        )
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
      const e = error as {
        code?: string
        details?: { dependencies?: Array<{ reason?: string; name?: string; id?: string }> }
      }
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

  function showProviderDependencies(
    provider: Provider,
    dependencies: Array<{ reason?: string; name?: string; id?: string }>
  ) {
    modal.warning({
      title: '服务商仍在使用中',
      content: h(
        'div',
        { style: 'white-space: pre-wrap' },
        `无法删除 ${provider.name}（${provider.id}）。\n\n依赖关系：\n${dependencies.map((item) => `- ${dependencyLabel(item)}`).join('\n')}`
      ),
      okText: '知道了',
    })
  }

  return {
    editing,
    creating,
    form,
    createForm,
    saving,
    providerOperation,
    providerOperationLoading,
    handleEditOpenChange,
    edit,
    openCreate,
    onCreateTypeChange,
    create,
    save,
    askDelete,
    remove,
  }
}
