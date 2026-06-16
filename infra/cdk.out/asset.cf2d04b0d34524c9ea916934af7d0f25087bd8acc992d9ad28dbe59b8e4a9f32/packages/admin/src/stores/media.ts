import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { MediaItem } from '@bobbykim/manguito-cms-core'

export const useMediaStore = defineStore('media', () => {
  const items = ref<Map<string, MediaItem>>(new Map())
  const loading = ref(false)

  function setItems(newItems: MediaItem[]) {
    items.value.clear()
    for (const item of newItems) {
      items.value.set(item.id, item)
    }
  }

  function setItem(item: MediaItem) {
    items.value.set(item.id, item)
  }

  function removeItem(id: string) {
    items.value.delete(id)
  }

  return {
    items,
    loading,
    setItems,
    setItem,
    removeItem,
  }
})
