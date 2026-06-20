import { nextTick, ref, watch, type Ref } from 'vue'

/**
 * Tracks the offsetLeft/offsetWidth of the tab matching `activeId` inside `containerRef`
 * (each tab button must carry `data-tab="<id>"`) so callers can render a sliding underline.
 */
export function useTabIndicator(containerRef: Ref<HTMLElement | null>, activeId: Ref<string>) {
  const left = ref(0)
  const width = ref(0)

  function measure() {
    const container = containerRef.value
    if (!container) return
    const el = container.querySelector<HTMLElement>(`[data-tab="${activeId.value}"]`)
    if (!el) return
    left.value = el.offsetLeft
    width.value = el.offsetWidth
  }

  watch([containerRef, activeId], () => {
    void nextTick(() => measure())
  }, { immediate: true })

  return { left, width, measure }
}
