import { ref } from 'vue'
import type { SaaSHostname } from '@/types'

export function useSaasHostnameModals({
  selectedHostname,
  load,
}: {
  selectedHostname: { value: SaaSHostname | null }
  load: (options?: Record<string, unknown>) => Promise<void>
}) {
  const editingHostname = ref<SaaSHostname | null>(null)
  const showCreateForm = ref(false)
  const showDetails = ref(false)
  const showFallbackOrigin = ref(false)
  const detailLoading = ref(false)

  function openFallbackOrigin() {
    showFallbackOrigin.value = true
  }

  function onFallbackUpdated() {
    load({ refresh: true })
  }

  function openCreate() {
    editingHostname.value = null
    showCreateForm.value = true
  }

  function openEdit(record: SaaSHostname) {
    handleDetailsOpenChange(false)
    editingHostname.value = record
    showCreateForm.value = true
  }

  async function openDetails(record: SaaSHostname) {
    selectedHostname.value = {
      ...record,
      ssl: { ...(record.ssl || {}) },
    }
    showDetails.value = true
    detailLoading.value = false
  }

  function handleDetailsOpenChange(open: boolean) {
    showDetails.value = open
    if (!open) {
      detailLoading.value = false
    }
  }

  function resetModals() {
    showCreateForm.value = false
    showDetails.value = false
    showFallbackOrigin.value = false
    editingHostname.value = null
    selectedHostname.value = null
    handleDetailsOpenChange(false)
  }

  return {
    editingHostname,
    selectedHostname,
    showCreateForm,
    showDetails,
    showFallbackOrigin,
    detailLoading,
    openFallbackOrigin,
    onFallbackUpdated,
    openCreate,
    openEdit,
    openDetails,
    handleDetailsOpenChange,
    resetModals,
  }
}
