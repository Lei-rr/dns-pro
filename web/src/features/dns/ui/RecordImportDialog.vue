<script setup lang="ts">
import { ref, watch } from 'vue'
import { FileUp, Info, Upload } from '@lucide/vue'
import { AppDialog } from '@/shared/ui/dialog'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { parseDnsFile, type ParsedImportRecord } from '../lib/record-import'
import { toast } from '@/shared/lib/toast'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  zoneName: string
  submitting?: boolean
}>()

const emit = defineEmits<{
  submit: [records: ParsedImportRecord[]]
}>()

const parsedRecords = ref<ParsedImportRecord[]>([])
const fileName = ref('')
const parseError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

watch(open, (isOpen) => {
  if (!isOpen) {
    parsedRecords.value = []
    fileName.value = ''
    parseError.value = ''
    if (fileInput.value) fileInput.value.value = ''
  }
})

function triggerSelect() {
  fileInput.value?.click()
}

async function onFileSelected(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

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

function handleConfirm() {
  if (!parsedRecords.value.length) return
  emit('submit', parsedRecords.value)
}
</script>

<template>
  <AppDialog v-model:open="open" title="批量导入 DNS 记录" content-class="sm:max-w-lg">
    <div class="space-y-4 text-sm">
      <input ref="fileInput" type="file" class="hidden" accept=".json,.csv,.zone,.txt,.bind" @change="onFileSelected" />

      <div
        class="border-border/80 hover:bg-muted/30 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer"
        @click="triggerSelect"
      >
        <div class="bg-muted flex size-10 items-center justify-center rounded-full">
          <Upload class="text-muted-foreground size-5" />
        </div>
        <div class="mt-3 font-medium">点击上传文件</div>
        <p class="text-muted-foreground mt-1 text-xs">支持 CSV（推荐）、JSON、BIND Zone 格式文本文件</p>
        <div v-if="fileName" class="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary">
          <FileUp class="size-3.5" />
          <span>{{ fileName }}</span>
        </div>
      </div>

      <div v-if="parseError" class="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-xs">
        {{ parseError }}
      </div>

      <div v-if="parsedRecords.length" class="space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground">已识别记录列表：</span>
          <span class="font-medium text-foreground">共 {{ parsedRecords.length }} 条</span>
        </div>

        <div class="max-h-[220px] overflow-y-auto rounded-lg border border-border/60 text-xs divide-y divide-border/40">
          <div
            v-for="(rec, idx) in parsedRecords.slice(0, 50)"
            :key="idx"
            class="flex items-center justify-between gap-2 p-2 hover:bg-muted/40"
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="font-semibold truncate max-w-[120px]">{{ rec.name }}</span>
              <Badge variant="secondary" class="text-[10px] h-4 px-1 shrink-0">{{ rec.type }}</Badge>
            </div>
            <span class="text-muted-foreground font-mono truncate max-w-[200px] text-right">{{ rec.value }}</span>
          </div>
        </div>

        <p v-if="parsedRecords.length > 50" class="text-muted-foreground text-[11px] text-center">
          仅预览前 50 条，确认后将全量导入 {{ parsedRecords.length }} 条记录
        </p>
      </div>

      <div class="text-muted-foreground flex items-start gap-1.5 text-[11px]">
        <Info class="size-3.5 shrink-0 mt-0.5" />
        <span>导入将调用批量添加任务后台执行，自动排重已存在的同名同值记录。</span>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <Button variant="outline" size="sm" @click="open = false">取消</Button>
        <LoadingButton
          size="sm"
          :loading="submitting"
          :disabled="!parsedRecords.length || submitting"
          @click="handleConfirm"
        >
          开始批量导入 ({{ parsedRecords.length }} 条)
        </LoadingButton>
      </div>
    </template>
  </AppDialog>
</template>
