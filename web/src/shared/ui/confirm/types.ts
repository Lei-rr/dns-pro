/** 确认弹窗里的可选勾选项（如删除时「跳过 DNS 清理」） */
export type ConfirmOptionChoice = {
  label: string
  /** 初始勾选状态，缺省不勾选 */
  defaultChecked?: boolean
}

export type ConfirmOptions = {
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
  /** 带勾选项的确认：结果里回传勾选状态（用于把选择权交给用户的操作） */
  option?: ConfirmOptionChoice
}

/** 带勾选项的确认结果：confirmed 为是否点了确认，checked 为确认时的勾选状态 */
export type ConfirmChoiceResult = { confirmed: boolean; checked: boolean }
