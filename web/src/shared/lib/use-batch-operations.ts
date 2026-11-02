import { computed, type Ref } from 'vue'
import { confirmDialog } from '@/shared/ui/confirm'
import { toast } from './toast'
import { errorMessage } from './errors'
import { useRowSelection } from './row-selection'
import { useRowBusy } from './row-busy'

interface BatchOperationConfig<T> {
  /** 数据列表 */
  items: Ref<T[]>
  /** 获取行唯一键 */
  getKey: (item: T) => string
  /** 操作确认提示 */
  confirmMessage?: (count: number) => string
  /** 操作成功提示 */
  successMessage?: (count: number) => string
}

interface BatchOperationOptions {
  /** 确认对话框标题 */
  confirmTitle?: string
  /** 确认对话框描述 */
  confirmDescription?: string
}

/**
 * 通用批量操作逻辑：
 * - 行选择管理
 * - 行忙碌状态
 * - 批量确认对话框
 * - 逐条执行 + 错误收集
 */
export function useBatchOperations<T>(config: BatchOperationConfig<T>) {
  const { items, getKey, confirmMessage, successMessage } = config

  const selection = useRowSelection(items, getKey)
  const { isBusy: isRowBusy, runBusy, reset: resetRowBusy } = useRowBusy()

  const selectedCount = computed(() => selection.selected.value.length)
  const hasSelection = computed(() => selectedCount.value > 0)

  /**
   * 执行批量操作
   * @param operation 单行操作函数
   * @param options 确认对话框配置
   */
  async function executeBatch(
    operation: (item: T, key: string) => Promise<void>,
    options: BatchOperationOptions = {}
  ): Promise<{ success: number; failed: number }> {
    const selectedKeys = selection.selected.value
    if (selectedKeys.length === 0) return { success: 0, failed: 0 }

    const { confirmTitle, confirmDescription } = options
    const message = confirmMessage?.(selectedKeys.length) || `确定要操作 ${selectedKeys.length} 项吗？`

    const confirmed = await confirmDialog({
      title: confirmTitle,
      description: confirmDescription || message,
    })

    if (!confirmed) return { success: 0, failed: 0 }

    let successCount = 0
    let failedCount = 0
    const errors: string[] = []

    const selectedItems = items.value.filter((item) => selectedKeys.includes(getKey(item)))

    for (const item of selectedItems) {
      const key = getKey(item)
      try {
        await runBusy(key, async () => {
          await operation(item, key)
        })
        successCount++
      } catch (error) {
        failedCount++
        errors.push(`${key}: ${errorMessage(error)}`)
      }
    }

    if (successCount > 0) {
      const message = successMessage?.(successCount) || `成功操作 ${successCount} 项`
      toast.success(message)
    }

    if (failedCount > 0) {
      const message = `失败 ${failedCount} 项${errors.length > 0 ? `：${errors.slice(0, 3).join('、')}` : ''}`
      toast.error(message)
    }

    selection.clear()
    return { success: successCount, failed: failedCount }
  }

  return {
    // 选择状态
    selection,
    selectedCount,
    hasSelection,
    // 忙碌状态
    isRowBusy,
    resetRowBusy,
    // 批量操作
    executeBatch,
  }
}
