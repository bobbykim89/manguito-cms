import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useMediaQuery } from '@vueuse/core'

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
  // Desktop: rail collapses to icon-only width. Mobile: rail becomes a slide-in drawer instead.
  const sidebarCollapsed = ref(false)
  const isMobile = useMediaQuery('(max-width: 820px)')
  const mobileNavOpen = ref(false)
  const activeModal = ref<string | null>(null)
  const maxFileSize = ref(0)
  // When true (cloud storage), uploads go straight to storage via presigned URL;
  // when false (local storage), they use the direct upload endpoint.
  const presignedUploads = ref(false)
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

  function setPresignedUploads(value: boolean) {
    presignedUploads.value = value
  }

  function setCmsName(name: string) {
    cmsName.value = name
  }

  // Single entry point for the topbar toggle button — collapses the rail on desktop,
  // opens the drawer on mobile.
  function toggleSidebar() {
    if (isMobile.value) {
      mobileNavOpen.value = !mobileNavOpen.value
    } else {
      sidebarCollapsed.value = !sidebarCollapsed.value
    }
  }

  function closeMobileNav() {
    mobileNavOpen.value = false
  }

  return {
    toasts,
    sidebarCollapsed,
    isMobile,
    mobileNavOpen,
    activeModal,
    maxFileSize,
    presignedUploads,
    cmsName,
    addToast,
    removeToast,
    setMaxFileSize,
    setPresignedUploads,
    setCmsName,
    toggleSidebar,
    closeMobileNav,
  }
})
