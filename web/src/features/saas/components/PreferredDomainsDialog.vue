<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ArrowDown, ArrowUp } from '@lucide/vue'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Field, FieldError } from '@/shared/ui/field'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'
import { AppDialog } from '@/shared/ui/dialog'
import { preferredDomainApi } from '@/features/saas/api/saas'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { serverFieldErrors } from '@/shared/lib/field-errors'
import { confirmDelete } from '@/shared/ui/confirm'

const open = defineModel<boolean>('open', { default: false })
withDefaults(
  defineProps<{
    hostCount?: number
    applying?: boolean
  }>(),
  { hostCount: 0, applying: false },
)
const emit = defineEmits<{
  update: [items: Array<{ domain: string }>]
  apply: [payload: { domain: string; onlyAutoPreferred?: boolean; dryRun?: boolean }]
}>()

const items = ref<Array<{ domain: string }>>([])
const loading = ref(false)
const saving = ref(false)
const newDomain = ref('')
const editingDomain = ref<string | null>(null)
const editingValue = ref('')
const applyingDomain = ref('')
const newDomainError = ref('')
const editingError = ref('')

async function load() {
  loading.value = true
  try {
    const response = await preferredDomainApi.list()
    items.value = response.data || []
    emit('update', items.value)
  } catch (error) {
    toast.error(errorMessage(error))
    items.value = []
  } finally {
    loading.value = false
  }
}

async function addDomain() {
  const domain = newDomain.value.trim()
  newDomainError.value = domain ? '' : '请输入优选域名'
  if (newDomainError.value) return
  saving.value = true
  try {
    await preferredDomainApi.create(domain)
    newDomain.value = ''
    toast.success('已添加')
    await load()
  } catch (error) {
    newDomainError.value = serverFieldErrors(error).domain || newDomainError.value
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

function startEdit(record: { domain: string }) {
  editingDomain.value = record.domain
  editingValue.value = record.domain
  editingError.value = ''
}

function cancelEdit() {
  editingDomain.value = null
  editingValue.value = ''
}

async function saveEdit() {
  if (!editingDomain.value) return
  const next = editingValue.value.trim()
  editingError.value = next ? '' : '域名不能为空'
  if (editingError.value) return
  saving.value = true
  try {
    await preferredDomainApi.rename(editingDomain.value, next)
    toast.success('已更新')
    cancelEdit()
    await load()
  } catch (error) {
    editingError.value = serverFieldErrors(error).domain || editingError.value
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function removeDomain(record: { domain: string }) {
  if (!(await confirmDelete(record.domain))) return
  saving.value = true
  try {
    await preferredDomainApi.delete(record.domain)
    toast.success('已删除')
    await load()
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

function applyDomain(record: { domain: string }, options: { onlyAutoPreferred?: boolean; dryRun?: boolean } = {}) {
  applyingDomain.value = record.domain
  // 正式切换会跑 Job：先关弹窗，露出页顶进度条；预览保留弹窗
  if (!options.dryRun) open.value = false
  emit('apply', { domain: record.domain, ...options })
  setTimeout(() => {
    applyingDomain.value = ''
  }, 800)
}

async function move(index: number, delta: number) {
  const next = index + delta
  if (next < 0 || next >= items.value.length) return
  const copy = items.value.slice()
  const [row] = copy.splice(index, 1)
  copy.splice(next, 0, row)
  items.value = copy
  saving.value = true
  try {
    await preferredDomainApi.sort(copy.map((item) => item.domain))
    emit('update', items.value)
    toast.success('排序已保存')
  } catch (error) {
    toast.error(errorMessage(error))
    await load()
  } finally {
    saving.value = false
  }
}

watch(open, (value) => {
  if (value) load()
})

onMounted(() => {
  if (open.value) load()
})
</script>

<template>
  <AppDialog
    v-model:open="open"
    title="管理优选域名"
    description="支持排序；创建/编辑主机名时可选择境内优选 CNAME，也可对当前列表一键切换。"
    content-class="sm:max-w-3xl"
  >
    <Field :data-invalid="!!newDomainError" class="flex flex-col gap-1">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input v-model="newDomain" class="h-9 flex-1" placeholder="如 saas.sin.fan" @keyup.enter="addDomain" />
        <LoadingButton size="sm" :loading="saving" @click="addDomain">添加</LoadingButton>
      </div>
      <FieldError :errors="newDomainError ? [newDomainError] : []" />
    </Field>

    <div class="rounded-lg">
      <Table>
        <TableHeader class="bg-muted/50">
          <TableRow class="!border-0">
            <TableHead class="w-20 rounded-l-lg px-3">排序</TableHead>
            <TableHead>域名</TableHead>
            <TableHead class="rounded-r-lg text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody class="**:data-[slot=table-cell]:py-2.5">
          
          <TableRow v-if="!items.length">
            <TableCell colspan="3" class="text-muted-foreground py-8 text-center">暂无优选域名</TableCell>
          </TableRow>
          <TableRow v-for="(record, index) in items" :key="record.domain">
            <TableCell class="px-3">
              <div class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-8"
                  :disabled="saving || applying || index === 0"
                  @click="move(index, -1)"
                >
                  <ArrowUp class="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-8"
                  :disabled="saving || applying || index === items.length - 1"
                  @click="move(index, 1)"
                >
                  <ArrowDown class="size-4" />
                </Button>
              </div>
            </TableCell>
            <TableCell>
              <Field v-if="editingDomain === record.domain" :data-invalid="!!editingError">
                <Input
                  v-model="editingValue"
                  class="h-8"
                  @keyup.enter="saveEdit"
                />
                <FieldError :errors="editingError ? [editingError] : []" />
              </Field>
              <span v-else class="font-medium">{{ record.domain }}</span>
            </TableCell>
            <TableCell class="text-right">
              <div class="flex flex-wrap justify-end gap-1">
                <template v-if="editingDomain === record.domain">
                  <LoadingButton variant="ghost" size="sm" :loading="saving" @click="saveEdit">保存</LoadingButton>
                  <Button variant="ghost" size="sm" @click="cancelEdit">取消</Button>
                </template>
                <template v-else>
                  <LoadingButton
                    variant="ghost"
                    size="sm"
                    :disabled="saving || applying || !hostCount"
                    :loading="applyingDomain === record.domain"
                    @click="applyDomain(record)"
                  >
                    应用到列表
                  </LoadingButton>
                  <Button
                    variant="ghost"
                    size="sm"
                    :disabled="saving || applying || !hostCount"
                    @click="applyDomain(record, { onlyAutoPreferred: true })"
                  >
                    仅自动优选
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    :disabled="saving || applying || !hostCount"
                    @click="applyDomain(record, { dryRun: true })"
                  >
                    预览
                  </Button>
                  <Button variant="ghost" size="sm" :disabled="saving || applying" @click="startEdit(record)">
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-destructive"
                    :disabled="saving || applying"
                    @click="removeDomain(record)"
                  >
                    删除
                  </Button>
                </template>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <template #footer>
      <Button variant="outline" @click="open = false">关闭</Button>
    </template>
  </AppDialog>
</template>
