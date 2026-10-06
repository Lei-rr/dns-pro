<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FileUp, Info, Upload } from '@lucide/vue'
import { AppDialog } from '@/shared/ui/dialog'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Checkbox } from '@/shared/ui/checkbox'
import { cn } from '@/shared/lib/utils'
import { parseDnsFile, type ParsedImportRecord } from '../lib/record-import'
import { buildImportPreview, type ImportPlan } from '../lib/record-import-preview'
import type { DnsRecord } from '../model/types'
import { toast } from '@/shared/lib/toast'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  zoneName: string
  existingRecords: DnsRecord[]
  submitting?: boolean
}>()

const emit = defineEmits<{
  submit: [plan: ImportPlan]
}>()

const parsedRecords = ref<ParsedImportRecord[]>([])
const fileName = ref('')
const parseError = ref('')
const isDragging = ref(false)
const overwriteExisting = ref(true)
const fileInput = ref<HTMLInputElement | null>(null)

/** F4：写入前 diff——新增 / 覆盖 / 重复跳过，用户确认后才落库。 */
const preview = computed(() => buildImportPreview(parsedRecords.value, props.existingRecords))
const overwriteCount = computed(() => (overwriteExisting.value ? preview.value.overwritten.length : 0))
const totalWriteCount = computed(() => preview.value.added.length + overwriteCount.value)

watch(open, (isOpen) => {
  if (!isOpen) {
    parsedRecords.value = []
    fileName.value = ''
    parseError.value = ''
    isDragging.value = false
    overwriteExisting.value = true
    if (fileInput.value) fileInput.value.value = ''
  }
})

function triggerSelect() {
  fileInput.value?.click()
}

async function processFile(file: File) {
  fileName.value = file.name
  parseError.value = ''
  try {
    const text = await file.text()
    const records = parseDnsFile(text, file.name, props.zoneName)
    if (!records.length) {
      parseError.value = '未从文件中识别到有效 DNS 记录'
      parsedRecords.value = []
      return
    }
    parsedRecords.value = records
    toast.success(`成功解析 ${records.length} 条记录`)
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : '文件解析失败'
    parsedRecords.value = []
  }
}

async function onFileSelected(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  await processFile(file)
}

async function onFileDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  await processFile(file)
}

function handleConfirm() {
  if (!totalWriteCount.value) return
  emit('submit', {
    added: preview.value.added,
    overwritten: overwriteExisting.value ? preview.value.overwritten : [],
  })
}
</script>

<template>
  <AppDialog v-model:open="open" title="批量导入 DNS 记录" content-class="sm:max-w-lg">
    <div class="space-y-4 text-sm">
      <input ref="fileInput" type="file" class="hidden" accept=".json,.csv,.zone,.txt,.bind" @change="onFileSelected" />

      <div
        :class="
          cn(
            'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all cursor-pointer select-none',
            isDragging
              ? 'border-primary bg-primary/10 ring-4 ring-primary/20 scale-[1.01]'
              : 'border-border/80 hover:border-primary/50 hover:bg-muted/30'
          )
        "
        @click="triggerSelect"
        @dragover.prevent="isDragging = true"
        @dragenter.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="onFileDrop"
      >
        <div
          :class="
            cn(
              'flex size-11 items-center justify-center rounded-full transition-colors',
              isDragging ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            )
          "
        >
          <Upload class="size-5" />
        </div>
        <div class="mt-3 font-medium">
          {{ isDragging ? '松开鼠标立即解析文件' : '点击或拖拽文件到此处' }}
        </div>
        <p class="text-muted-foreground mt-1 text-xs">支持 CSV（推荐）、JSON、BIND Zone 格式文本文件</p>
        <div v-if="fileName" class="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary">
          <FileUp class="size-3.5" />
          <span>{{ fileName }}</span>
        </div>
      </div>

      <div v-if="parseError" class="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-xs">
        {{ parseError }}
      </div>

      <div v-if="parsedRecords.length" class="space-y-3">
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="rounded-lg border border-border/60 bg-muted/30 px-2 py-2">
            <div class="text-lg font-semibold tabular-nums text-foreground">
              {{ preview.added.length }}
            </div>
            <div class="text-[11px] text-muted-foreground">新增</div>
          </div>
          <div class="rounded-lg border border-border/60 bg-muted/30 px-2 py-2">
            <div class="text-lg font-semibold tabular-nums text-foreground">
              {{ preview.overwritten.length }}
            </div>
            <div class="text-[11px] text-muted-foreground">覆盖同名同类型</div>
          </div>
          <div class="rounded-lg border border-border/60 bg-muted/30 px-2 py-2">
            <div class="text-lg font-semibold tabular-nums text-muted-foreground">{{ preview.duplicates.length }}</div>
            <div class="text-[11px] text-muted-foreground">重复跳过</div>
          </div>
        </div>

        <label v-if="preview.overwritten.length" class="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox v-model="overwriteExisting" />
          <span>用文件内容覆盖已有的同名同类型记录（不勾选则跳过这 {{ preview.overwritten.length }} 条）</span>
        </label>

        <div class="max-h-[220px] overflow-y-auto rounded-lg border border-border/60 text-xs divide-y divide-border/40">
          <div
            v-for="(rec, idx) in preview.added.slice(0, 50)"
            :key="`add-${idx}`"
            class="flex items-center justify-between gap-2 p-2 hover:bg-muted/40"
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <Badge variant="secondary" class="text-[10px] h-4 px-1 shrink-0">新增</Badge>
              <span class="font-semibold truncate max-w-[110px]">{{ rec.name }}</span>
              <Badge variant="outline" class="text-[10px] h-4 px-1 shrink-0">{{ rec.type }}</Badge>
            </div>
            <span class="text-muted-foreground font-mono truncate max-w-[180px] text-right">{{ rec.value }}</span>
          </div>
          <div
            v-for="(item, idx) in preview.overwritten.slice(0, 50)"
            :key="`upd-${idx}`"
            class="flex items-center justify-between gap-2 p-2 hover:bg-muted/40"
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <Badge variant="outline" class="text-[10px] h-4 px-1 shrink-0">覆盖</Badge>
              <span class="font-semibold truncate max-w-[110px]">{{ item.incoming.name }}</span>
              <Badge variant="outline" class="text-[10px] h-4 px-1 shrink-0">{{ item.incoming.type }}</Badge>
            </div>
            <span class="text-muted-foreground font-mono truncate max-w-[180px] text-right">
              {{ item.existing.value ?? item.existing.content }} → {{ item.incoming.value }}
            </span>
          </div>
        </div>

        <p
          v-if="preview.added.length + preview.overwritten.length > 50"
          class="text-muted-foreground text-[11px] text-center"
        >
          仅预览前 50 条差异，确认后将写入 {{ totalWriteCount }} 条记录
        </p>
      </div>

      <div class="text-muted-foreground flex items-start gap-1.5 text-[11px]">
        <Info class="size-3.5 shrink-0 mt-0.5" />
        <span>新增记录走批量添加任务后台执行；覆盖为逐条更新，失败会汇总提示。</span>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <Button variant="outline" size="sm" @click="open = false">取消</Button>
        <LoadingButton
          size="sm"
          :loading="submitting"
          :disabled="!totalWriteCount || submitting"
          @click="handleConfirm"
        >
          写入 {{ totalWriteCount }} 条（新增 {{ preview.added.length }} / 覆盖 {{ overwriteCount }}）
        </LoadingButton>
      </div>
    </template>
  </AppDialog>
</template>
