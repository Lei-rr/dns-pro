import { ref } from 'vue'
import type { ConfirmChoiceResult, ConfirmOptionChoice, ConfirmOptions } from './types'

/** 默认文案单一来源：模块初值与 confirmDialog 的兜底共用，避免两处字面量各改一半 */
const DEFAULT_CONFIRM_OPTIONS = {
  title: '确认操作',
  description: '此操作不可撤销，确定继续吗？',
  confirmText: '确认',
  cancelText: '取消',
  destructive: true,
}

const open = ref(false)
const options = ref<ConfirmOptions>({ ...DEFAULT_CONFIRM_OPTIONS })
/** 可选勾选项的当前状态：弹窗关闭后保留最后值，但只有 confirmed 时才会被消费 */
const optionChecked = ref(false)

let resolver: ((value: ConfirmChoiceResult) => void) | null = null

function settlePrev() {
  // 若上一次弹窗异常未 settle，先以「取消」收尾，避免永久挂起
  if (!resolver) return
  const prev = resolver
  resolver = null
  prev({ confirmed: false, checked: false })
}

/**
 * 带勾选项的确认弹窗（本模块内部底层）。返回值区分「是否确认」与「勾选状态」：
 * 调用方据此把可选行为（如删除时跳过 DNS 清理）交给用户选择，而不是写死一种。
 * 对外只暴露 confirmDialog / confirmDeleteWithSkipCleanup 两个语义化入口。
 */
function confirmWithOption(opts: ConfirmOptions = {}): Promise<ConfirmChoiceResult> {
  settlePrev()
  options.value = {
    title: opts.title || DEFAULT_CONFIRM_OPTIONS.title,
    description: opts.description || DEFAULT_CONFIRM_OPTIONS.description,
    confirmText: opts.confirmText || DEFAULT_CONFIRM_OPTIONS.confirmText,
    cancelText: opts.cancelText || DEFAULT_CONFIRM_OPTIONS.cancelText,
    destructive: opts.destructive ?? DEFAULT_CONFIRM_OPTIONS.destructive,
    option: opts.option,
  }
  optionChecked.value = opts.option?.defaultChecked ?? false
  open.value = true
  return new Promise<ConfirmChoiceResult>((resolve) => {
    resolver = resolve
  })
}

export function confirmDialog(opts: ConfirmOptions = {}): Promise<boolean> {
  return confirmWithOption(opts).then((result) => result.confirmed)
}

export function confirmDelete(name: string, extra = ''): Promise<boolean> {
  return confirmDialog({
    title: '确认删除',
    description: `确认删除 ${name}？${extra ? `\n${extra}` : ''}`,
    confirmText: '删除',
    cancelText: '取消',
    destructive: true,
  })
}

/** 「删除时是否跳过 DNS 清理」勾选项：默认不勾（保持既有行为：删除会连带清理解析记录） */
export const SKIP_DNS_CLEANUP_OPTION: ConfirmOptionChoice = {
  label: '跳过 DNS 清理：保留当前解析记录，稍后自行处理',
  defaultChecked: false,
}

/**
 * 删除确认（附「跳过 DNS 清理」勾选项）。
 * 后端 auto_cleanup=false 一直可用，但界面从未把这个选择暴露出来：
 * 勾选与否都要能从返回值区分，调用方据此决定是否下发 skipCleanup。
 */
export function confirmDeleteWithSkipCleanup(name: string, extra = ''): Promise<ConfirmChoiceResult> {
  return confirmWithOption({
    title: '确认删除',
    description: `确认删除 ${name}？${extra ? `\n${extra}` : ''}`,
    confirmText: '删除',
    cancelText: '取消',
    destructive: true,
    option: SKIP_DNS_CLEANUP_OPTION,
  })
}

export function settleConfirm(value: boolean) {
  open.value = false
  if (!resolver) return
  const r = resolver
  resolver = null
  r({ confirmed: value, checked: optionChecked.value })
}

function hasPendingConfirm() {
  return resolver != null
}

export const confirmState = {
  open,
  options,
  optionChecked,
  hasPending: hasPendingConfirm,
}
