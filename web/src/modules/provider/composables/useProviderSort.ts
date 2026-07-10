import { ref } from 'vue'
import { providerSettingsApi } from '@/modules/provider/api/providers'
import { replaceProvidersCache } from '@/stores/providers'
import { message } from '@/shared/plugins/antDesignVue'
import { errorMessage } from '@/shared/utils/errors'
import type { Provider } from '@/types'

export function useProviderSort(providers: { value: Provider[] }) {
  const draggingProvider = ref('')
  const sortSaving = ref(false)

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
      onDragend: () => {
        draggingProvider.value = ''
      },
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

  return {
    draggingProvider,
    sortSaving,
    sortHandleProps,
    providerRowProps,
  }
}
