import { ref } from 'vue'
import { defineStore } from 'pinia'

export const DEFAULT_PAGE_SIZE = 50

export const useContentStore = defineStore('content', () => {
  const pages = ref<Map<string, unknown[]>>(new Map())
  const total = ref(0)
  const loading = ref(false)

  function cacheKey(contentType: string, page: number, perPage: number): string {
    return `${contentType}:${page}:${perPage}`
  }

  function setPage(contentType: string, page: number, perPage: number, items: unknown[]) {
    pages.value.set(cacheKey(contentType, page, perPage), items)
  }

  function getPage(contentType: string, page: number, perPage: number): unknown[] | undefined {
    return pages.value.get(cacheKey(contentType, page, perPage))
  }

  function invalidate(contentType: string) {
    const prefix = `${contentType}:`
    for (const key of [...pages.value.keys()]) {
      if (key.startsWith(prefix)) {
        pages.value.delete(key)
      }
    }
  }

  return {
    pages,
    total,
    loading,
    setPage,
    getPage,
    invalidate,
  }
})
