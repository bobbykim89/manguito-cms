// Dev-server request routing.
//
// The dev server fronts two backends: the Hono app (REST API + GraphQL) and the
// Vite middleware serving the admin SPA. Anything not claimed by Hono falls
// through to Vite, which answers with the SPA shell — so a backend path that is
// missing from this predicate does not 404, it silently renders the admin app
// and the Vue router reports "No match found for location ...". Keeping the
// decision here, as a pure function, makes that easy to test.

/** Absolute backend paths mounted outside the configurable `/api` prefix. */
const ABSOLUTE_BACKEND_PATHS = ['/graphql']

/**
 * True when the request belongs to the Hono backend rather than the Vite-served
 * admin SPA.
 *
 * @param url       Raw request URL, which may carry a query string.
 * @param apiPrefix Configured public API prefix (e.g. `/api`).
 */
export function shouldBridgeToHono(url: string, apiPrefix: string): boolean {
  // Compare against the path only; `/graphql?query=...` must still match.
  const path = url.split('?')[0] ?? ''

  if (path.startsWith(apiPrefix)) return true
  if (path.startsWith('/admin/api')) return true

  // Exact match: `/graphql` is the endpoint, but `/graphqlfoo` is not, and
  // `/admin/graphql` belongs to the SPA.
  return ABSOLUTE_BACKEND_PATHS.includes(path)
}
