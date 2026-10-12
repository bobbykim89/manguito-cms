export type ServerDetail = { field: string; message: string }

// A 422's details, split into those a form shows next to one of its fields and
// the rest: paths inside paragraph items, such as "cards[0].heading", which
// have no field of their own in the form state, so the form lists them with
// its error message instead.
export function splitServerDetails(
  details: ServerDetail[],
  fieldNames: string[],
): { fieldErrors: ServerDetail[]; other: string[] } {
  const known = new Set(fieldNames)
  const fieldErrors: ServerDetail[] = []
  const other: string[] = []
  for (const d of details) {
    if (known.has(d.field)) fieldErrors.push(d)
    else other.push(d.message)
  }
  return { fieldErrors, other }
}
