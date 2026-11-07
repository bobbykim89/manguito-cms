// A copy of `list` with the item at `from` moved to `to`, or null when there is
// nothing to move (the same index, or one outside the list), so a caller can
// skip emitting an unchanged list.
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] | null {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return null
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved as T)
  return next
}
