import { ref } from 'vue'
import { defineStore } from 'pinia'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export type Toast = {
  id: string
  variant: ToastVariant
  message: string
  duration: number | null
}

const MAX_VISIBLE = 3
const DEFAULT_DURATION = 4000

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const sidebarOpen = ref(true)
  const activeModal = ref<string | null>(null)
  const maxFileSize = ref(0)
  const cmsName = ref('Manguito CMS')

  function addToast(variant: ToastVariant, message: string, duration: number | null = DEFAULT_DURATION) {
    // Evict oldest when at capacity before adding the new one.
    if (toasts.value.length >= MAX_VISIBLE) {
      toasts.value.shift()
    }

    const id = crypto.randomUUID()
    toasts.value.push({ id, variant, message, duration })

    if (duration !== null) {
      setTimeout(() => removeToast(id), duration)
    }
  }

  function removeToast(id: string) {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index !== -1) {
      toasts.value.splice(index, 1)
    }
  }

  function setMaxFileSize(bytes: number) {
    maxFileSize.value = bytes
  }

  function setCmsName(name: string) {
    cmsName.value = name
  }

  return {
    toasts,
    sidebarOpen,
    activeModal,
    maxFileSize,
    cmsName,
    addToast,
    removeToast,
    setMaxFileSize,
    setCmsName,
  }
})
