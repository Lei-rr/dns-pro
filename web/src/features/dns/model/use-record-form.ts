import { reactive, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { dnsApi, type DnsProviderRef } from '../api/dns-api'
import type { DnsRecord } from '../model/types'
import { parseRecordNames } from '../lib/record-names'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { serverFieldErrors, type FieldErrors } from '@/shared/lib/field-errors'
import { runBatchJob, type useJobProgress } from '@/shared/job'

export type RecordFormState = {
  name: string
  type: string
  value: string
  ttl: string
  line: string
  remark: string
  priority: string
  proxied: boolean
}

/** 单条记录的新增 / 编辑：表单状态、校验与写后刷新。 */
export function useRecordForm(options: {
  provider: MaybeRefOrGetter<DnsProviderRef>
  zoneId: MaybeRefOrGetter<string>
  zoneName: MaybeRefOrGetter<string>
  cloudflare: MaybeRefOrGetter<boolean>
  lineIdOf: (line: string) => string | undefined
  invalidate: () => Promise<void>
  jobProgress: ReturnType<typeof useJobProgress>
}) {
  const dialogOpen = ref(false)
  const saving = ref(false)
  const editing = ref<DnsRecord | null>(null)
  const formErrors = ref<FieldErrors>({})
  const form = reactive<RecordFormState>({
    name: '',
    type: 'A',
    value: '',
    ttl: '600',
    line: '默认',
    remark: '',
    priority: '',
    proxied: false,
  })

  function openCreate() {
    editing.value = null
    formErrors.value = {}
    form.name = ''
    form.type = 'A'
    form.value = ''
    form.ttl = toValue(options.cloudflare) ? '1' : '600'
    form.line = '默认'
    form.remark = ''
    form.priority = ''
    form.proxied = false
    dialogOpen.value = true
  }

  function openEdit(record: DnsRecord) {
    editing.value = record
    formErrors.value = {}
    form.name = String(record.name || '')
    form.type = String(record.type || 'A')
    form.value = String(record.value || record.content || '')
    form.ttl = String(record.ttl ?? (toValue(options.cloudflare) ? '1' : '600'))
    form.line = String(record.line || '默认')
    form.remark = String(record.remark || record.comment || '')
    form.priority = String(record.priority ?? record.mx ?? '')
    form.proxied = !!record.proxied
    dialogOpen.value = true
  }

  async function save() {
    if (saving.value) return
    const provider = toValue(options.provider)
    const zoneId = toValue(options.zoneId)
    const zoneName = toValue(options.zoneName)
    const errors: FieldErrors = {}
    const names = parseRecordNames(form.name)
    const value = form.value.trim()
    const ttl = Number(form.ttl)
    if (!names.length) errors.name = '主机记录不能为空'
    if (!value) errors.value = '记录值不能为空'
    // 与批量修改同口径：非法 TTL 显式报错，不静默替换成默认值
    if (!Number.isFinite(ttl) || ttl <= 0) errors.ttl = 'TTL 需为正整数'
    if (editing.value && names.length !== 1) errors.name = '编辑时只能填写一个主机记录'
    formErrors.value = errors
    if (Object.keys(errors).length) return

    saving.value = true
    try {
      const base = {
        type: form.type,
        value,
        ttl,
        line: form.line,
        record_line_id: options.lineIdOf(form.line),
        remark: form.remark,
        priority: form.priority === '' || !Number.isFinite(Number(form.priority)) ? undefined : Number(form.priority),
        proxied: form.proxied,
        // 编辑时必须回传原有启停状态与权重，否则会被上游重置
        status: editing.value ? String(editing.value.status || '').toUpperCase() || undefined : undefined,
        weight: editing.value?.weight,
      }

      if (editing.value && !editing.value.id) {
        toast.error('该记录缺少 ID，无法编辑，请刷新后重试')
        return
      }
      if (editing.value?.id) {
        await dnsApi.updateRecord(provider, zoneId, String(editing.value.id), { ...base, name: names[0] }, { zoneName })
        toast.success('记录已更新')
        dialogOpen.value = false
        await options.invalidate()
      } else if (names.length === 1) {
        await dnsApi.createRecord(provider, zoneId, { ...base, name: names[0] }, { zoneName })
        toast.success('记录已创建')
        dialogOpen.value = false
        await options.invalidate()
      } else {
        // 先关弹窗，才能看到页顶 JobProgressAlert
        dialogOpen.value = false
        saving.value = false
        await runBatchJob({
          label: '批量创建',
          create: () =>
            dnsApi.batchCreateRecords(provider, zoneId, { records: names.map((name) => ({ ...base, name })) }),
          fetchJob: async (id) => ((await dnsApi.batchJob(provider, id)).data as Record<string, unknown>) || {},
          retry: (id) => dnsApi.batchRetry(provider, id),
          onDone: () => options.invalidate(),
          jobProgress: options.jobProgress,
        })
        return
      }
    } catch (error) {
      formErrors.value = {
        ...formErrors.value,
        ...serverFieldErrors(error, {
          subdomain: 'name',
          record_type: 'type',
          content: 'value',
        }),
      }
      toast.error(errorMessage(error))
    } finally {
      saving.value = false
    }
  }

  return { dialogOpen, saving, editing, formErrors, form, openCreate, openEdit, save }
}
