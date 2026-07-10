import { ref } from 'vue'
import type { SaaSHostname } from '@/types'

export function useSaasHostnameSelection() {
  const selectedHostnames = ref<SaaSHostname[]>([])
  const selectionResetKey = ref(0)

  function selectHostnames(_keys: Array<string | number>, rows: SaaSHostname[]) {
    selectedHostnames.value = rows
  }

  function clearSelection() {
    selectedHostnames.value = []
    selectionResetKey.value += 1
  }

  return {
    selectedHostnames,
    selectionResetKey,
    selectHostnames,
    clearSelection,
  }
}
