import { ref } from 'vue'
import { preferredDomainApi } from '../utils/api'
import { useLatestTask } from '@/shared/composables/useLatestTask'

export function usePreferredDomains() {
  const preferredDomains = ref<Array<{ domain: string }>>([])
  const showPreferredManager = ref(false)
  const preferredLoadTask = useLatestTask()

  async function loadPreferredDomains() {
    const requestToken = preferredLoadTask.next()
    try {
      const response = await preferredDomainApi.list()
      if (!preferredLoadTask.isCurrent(requestToken)) return
      preferredDomains.value = response.data
    } catch {
      if (!preferredLoadTask.isCurrent(requestToken)) return
      preferredDomains.value = []
    }
  }

  function openPreferredManager() {
    showPreferredManager.value = true
  }

  function onPreferredUpdate(items: Array<{ domain: string }>) {
    preferredDomains.value = items || []
  }

  return {
    preferredDomains,
    showPreferredManager,
    loadPreferredDomains,
    openPreferredManager,
    onPreferredUpdate,
  }
}
