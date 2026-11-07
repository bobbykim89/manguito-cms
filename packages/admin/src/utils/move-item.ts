// A copy of `list` with the item at `from` moved to `to`. An index outside the
// list, or `from === to`, returns an unchanged copy.
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved as T)
  return next
}
