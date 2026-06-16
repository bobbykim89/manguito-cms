import { ref, computed } from 'vue'

export function useDirtyState() {
  const currentData = ref<unknown>(null)
  const savedSnapshot = ref<unknown>(null)
  const hasSaved = ref(false)

  // Comparing via JSON.stringify handles nested objects. Form data is expected
  // to be serializable plain objects — no class instances or circular refs.
  const isDirty = computed(() => {
    if (!hasSaved.value) return false
    return JSON.stringify(currentData.value) !== JSON.stringify(savedSnapshot.value)
  })

  function markSaved(data: unknown) {
    const snapshot = JSON.parse(JSON.stringify(data ?? null)) as unknown
    currentData.value = snapshot
    savedSnapshot.value = snapshot
    hasSaved.value = true
  }

  function confirmNavigation(): boolean {
    if (!isDirty.value) return true
    return window.confirm('You have unsaved changes. Are you sure you want to leave?')
  }

  return { currentData, isDirty, markSaved, confirmNavigation }
}
