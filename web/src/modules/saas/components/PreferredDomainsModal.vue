<template>
  <a-modal :open="open" @update:open="emitOpen" title="管理优选域名" width="720px" :footer="null">
    <a-typography-paragraph type="secondary">
      创建/编辑自定义主机名时可从这里选择“境内优选 CNAME”目标。同步到 DNSPod 时会下发线路为「境内」的 CNAME。
      <template v-if="hostCount > 0">
        也可对当前列表 {{ hostCount }} 个主机名一键切换优选域名。
      </template>
    </a-typography-paragraph>
    <a-form layout="inline" style="margin-bottom: 12px; width: 100%">
      <a-form-item style="flex: 1">
        <a-input v-model:value="newDomain" placeholder="如 saas.sin.fan" allow-clear @press-enter="addDomain" />
      </a-form-item>
      <a-form-item>
        <a-button type="primary" :loading="saving" @click="addDomain">添加</a-button>
      </a-form-item>
    </a-form>
    <a-table
      :data-source="items"
      :row-key="rowKey"
      :loading="loading"
      :pagination="false"
      size="small"
      :custom-row="rowProps"
      :locale="{ emptyText: '暂无优选域名' }"
      :columns="[
        { title: '排序', key: 'sort', width: 60 },
        { title: '域名', dataIndex: 'domain', key: 'domain' },
        { title: '操作', key: 'actions', width: 360, align: 'right' },
      ]"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'sort'">
          <a-typography-text type="secondary" style="cursor: grab" title="拖动调整顺序">☰</a-typography-text>
        </template>
        <template v-else-if="column.key === 'domain'">
          <template v-if="editingDomain === record.domain">
            <a-input v-model:value="editingValue" size="small" @press-enter="saveEdit" />
          </template>
          <template v-else>{{ record.domain }}</template>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space size="small">
            <template v-if="editingDomain === record.domain">
              <a-button type="link" size="small" :loading="saving" @click="saveEdit">保存</a-button>
              <a-button type="link" size="small" @click="cancelEdit">取消</a-button>
            </template>
            <template v-else>
              <a-button
                type="link"
                size="small"
                :disabled="saving || applying || !hostCount"
                :loading="applyingDomain === record.domain"
                @click="askApply(record)"
              >
                应用到当前列表
              </a-button>
              <a-button type="link" size="small" :disabled="saving || applying || !hostCount" @click="askApplyOnlyAuto(record)">
                仅自动优选
              </a-button>
              <a-button type="link" size="small" :disabled="saving || applying || !hostCount" @click="askPreview(record)">
                预览
              </a-button>
              <a-button type="link" size="small" :disabled="saving || applying" @click="startEdit(record)">编辑</a-button>
              <a-button type="link" size="small" danger :disabled="saving || applying" @click="askDelete(record)">删除</a-button>
            </template>
          </a-space>
        </template>
      </template>
    </a-table>
    <div style="text-align: right; margin-top: 16px">
      <a-button @click="close">关闭</a-button>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { preferredDomainApi } from '../utils/api'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'

const props = defineProps<{
  open?: boolean
  hostCount?: number
  applying?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update', items: Array<{ domain: string }>): void
  (e: 'apply', domain: string, options?: { onlyAutoPreferred?: boolean; dryRun?: boolean }): void
}>()

const items = ref<Array<{ domain: string }>>([])
const loading = ref(false)
const saving = ref(false)
const newDomain = ref('')
const editingDomain = ref<string | null>(null)
const editingValue = ref('')
const draggingDomain = ref<string | null>(null)
const applyingDomain = ref<string | null>(null)

const hostCount = computed(() => Number(props.hostCount || 0))
const applying = computed(() => Boolean(props.applying))

watch(
  () => props.applying,
  (value) => {
    if (!value) applyingDomain.value = null
  }
)

watch(
  () => props.open,
  (value) => {
    if (value) {
      resetEditing()
      newDomain.value = ''
      load()
    }
  }
)

async function load() {
  loading.value = true
  try {
    const response = await preferredDomainApi.list()
    items.value = response.data || []
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}
function notifyChange() {
  emit('update', [...items.value])
}
function resetEditing() {
  editingDomain.value = null
  editingValue.value = ''
}
async function addDomain() {
  const domain = String(newDomain.value || '').trim()
  if (!domain) {
    message.warning('请输入域名')
    return
  }
  saving.value = true
  try {
    const response = await preferredDomainApi.create(domain)
    items.value.push(response.data)
    newDomain.value = ''
    message.success('已添加')
    notifyChange()
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}
function startEdit(item: { domain: string }) {
  editingDomain.value = item.domain
  editingValue.value = item.domain
}
function cancelEdit() {
  resetEditing()
}
async function saveEdit() {
  if (editingDomain.value === null) return
  const newDomain = String(editingValue.value || '').trim()
  if (!newDomain) {
    message.warning('域名不能为空')
    return
  }
  if (newDomain === editingDomain.value) {
    resetEditing()
    return
  }
  saving.value = true
  try {
    const response = await preferredDomainApi.rename(editingDomain.value, newDomain)
    const index = items.value.findIndex((item) => item.domain === editingDomain.value)
    if (index >= 0) items.value.splice(index, 1, response.data)
    message.success('已更新')
    resetEditing()
    notifyChange()
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}
function askDelete(item: { domain: string }) {
  modal.confirm({
    title: '删除优选域名',
    content: `确认删除 ${item.domain}？已使用该域名的 hostname 不会被自动清理。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => removeItem(item),
  })
}
function askApply(item: { domain: string }) {
  if (!hostCount.value) {
    message.warning('当前列表没有可切换的主机名')
    return
  }
  modal.confirm({
    title: '一键切换优选域名',
    content: `确认将当前列表 ${hostCount.value} 个自定义主机名的优选域名切换为 ${item.domain}？将创建后台任务逐个更新并同步 DNS。`,
    okText: '切换全部',
    cancelText: '取消',
    onOk: () => {
      applyingDomain.value = item.domain
      emit('apply', item.domain)
    },
  })
}

function askApplyOnlyAuto(item: { domain: string }) {
  if (!hostCount.value) {
    message.warning('当前列表没有可切换的主机名')
    return
  }
  modal.confirm({
    title: '只切换自动优选主机',
    content: `仅对“自动优选=开”的主机切换为 ${item.domain}？`,
    okText: '开始切换',
    onOk: () => {
      applyingDomain.value = item.domain
      emit('apply', item.domain, { onlyAutoPreferred: true })
    },
  })
}

function askPreview(item: { domain: string }) {
  emit('apply', item.domain, { dryRun: true })
}
async function removeItem(item: { domain: string }) {
  saving.value = true
  try {
    await preferredDomainApi.delete(item.domain)
    items.value = items.value.filter((row) => row.domain !== item.domain)
    message.success('已删除')
    notifyChange()
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}
function rowProps(record: { domain: string }) {
  return {
    class: draggingDomain.value === record.domain ? 'preferred-domain-row-dragging' : '',
    draggable: !saving.value && !applying.value,
    onDragstart: (event: DragEvent) => {
      if (applying.value) return
      draggingDomain.value = record.domain
      event.dataTransfer!.effectAllowed = 'move'
      event.dataTransfer!.setData('text/plain', record.domain)
      const row = (event.currentTarget as HTMLElement).closest('tr')
      if (row) event.dataTransfer!.setDragImage(row, 0, Math.floor(row.offsetHeight / 2))
    },
    onDragover: (event: DragEvent) => {
      if (draggingDomain.value === null || saving.value || applying.value) return
      event.preventDefault()
      event.dataTransfer!.dropEffect = 'move'
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      dropOn(record.domain)
    },
    onDragend: () => {
      draggingDomain.value = null
    },
  }
}
async function dropOn(targetDomain: string) {
  const sourceDomain = draggingDomain.value
  if (!sourceDomain || sourceDomain === targetDomain || saving.value) return

  const sourceIndex = items.value.findIndex((item) => item.domain === sourceDomain)
  const targetIndex = items.value.findIndex((item) => item.domain === targetDomain)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return

  const previous = [...items.value]
  const next = [...items.value]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  items.value = next
  saving.value = true
  try {
    const response = await preferredDomainApi.sort(next.map((item) => item.domain))
    items.value = response.data || []
    notifyChange()
  } catch (error) {
    items.value = previous
    message.error(errorMessage(error))
  } finally {
    saving.value = false
    draggingDomain.value = null
  }
}
function close() {
  emit('update:open', false)
}
function emitOpen(value: boolean) {
  emit('update:open', value)
}
function rowKey(record: { domain: string }) {
  return record.domain
}
</script>
