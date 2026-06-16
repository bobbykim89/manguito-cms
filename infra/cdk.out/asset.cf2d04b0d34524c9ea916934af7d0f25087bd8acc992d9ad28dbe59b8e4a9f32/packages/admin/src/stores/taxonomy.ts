import { ref } from 'vue'
import { defineStore } from 'pinia'

export const DEFAULT_PAGE_SIZE = 50

export const useTaxonomyStore = defineStore('taxonomy', () => {
  const pages = ref<Map<string, unknown[]>>(new Map())
  const total = ref(0)
  const loading = ref(false)

  function cacheKey(taxonomyType: string, page: number, perPage: number): string {
    return `${taxonomyType}:${page}:${perPage}`
  }

  function setPage(taxonomyType: string, page: number, perPage: number, items: unknown[]) {
    pages.value.set(cacheKey(taxonomyType, page, perPage), items)
  }

  function getPage(taxonomyType: string, page: number, perPage: number): unknown[] | undefined {
    return pages.value.get(cacheKey(taxonomyType, page, perPage))
  }

  function invalidate(taxonomyType: string) {
    const prefix = `${taxonomyType}:`
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
