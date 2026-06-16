# Decision — API Integration Test Strategy

> How API tests are structured, what they exercise, and the test helpers that make them work.

---

## Real DB, No Mocking

API integration tests run against a **real Postgres test DB**. The DB layer is never mocked.

The interesting bugs in a CMS API live at the boundary between route handlers and the DB — permission checks against real role data, slug uniqueness enforcement, reference integrity on content items. Mocking the DB would make those tests worthless as correctness guarantees and could create false confidence that hides real production failures.

---

## No Real HTTP Server

API tests use Hono's built-in `app.request()` helper. No HTTP server is started. Requests go directly into the Hono app instance.

```ts
const res = await app.request('/admin/api/content/articles', {
  method: 'GET',
  headers: { Cookie: 'auth_token=...' }
})
const body = await res.json()
```

This is fast, reliable, and avoids port conflicts in CI.

---

## `createTestApp()`

Defined in `test-utils/requests.ts`. Constructs a fully wired Hono app instance for tests.

```ts
function createTestApp(schema: ParsedSchema, db: PostgresAdapter): HonoApp
```

**Behavior:**
- Accepts `testParsedSchema` and a connected `PostgresAdapter` — never reads `manguito.config.ts` from disk
- Builds the roles registry from the test fixture roles
- Wires all middleware (auth, permission, hierarchy, mustChangePassword)
- Registers all generated routes and admin routes
- Returns a Hono app instance ready for `app.request()` calls

**Why not use `createServer()` directly:** The production `createServer()` reads config from disk and makes assumptions about the environment. Tests need a controlled, deterministic setup using known fixture data.

**Rate limit state:** The rate limiter is in-memory. Each `createTestApp()` call creates a fresh app instance with fresh rate limit state. Rate limit tests must not share an app instance with other tests.

---

## `authenticatedRequest()`

Defined in `test-utils/requests.ts`. Constructs a request with a pre-signed JWT for a given role.

```ts
function authenticatedRequest(
  app: HonoApp,
  role: 'admin' | 'manager' | 'editor' | 'writer' | 'viewer',
  method: string,
  path: string,
  options?: { body?: unknown; headers?: Record<string, string> }
): Promise<Response>
```

**Behavior:**
- Looks up the global role user fixture for the given role
- Signs a JWT with the correct `user_id`, `role`, `token_version`, and a non-expired `expires_at`
- Sets the `Cookie: auth_token=<token>` header on the request
- Calls `app.request()` and returns the response

**Why not use the login endpoint:** Calling login on every test is slow, couples tests to the login implementation, and creates rate limiting complications. Pre-signing a JWT is equivalent and much simpler.

---

## Cookie Assertions

Login and logout responses are tested by inspecting the `Set-Cookie` response header directly:

```ts
const res = await app.request('/admin/api/auth/login', { method: 'POST', body: ... })
const setCookie = res.headers.get('Set-Cookie')
expect(setCookie).toContain('auth_token=')
expect(setCookie).toContain('HttpOnly')
expect(setCookie).toContain('SameSite=Strict')
```

This verifies cookie attributes without a real browser environment.

---

## Test Structure

API integration tests follow natural lifecycle order within each describe block:

```
describe('articles') {
  describe('unauthenticated') {
    it('GET /admin/api/content/articles returns 401')
  }
  describe('authenticated as editor') {
    it('POST — creates article')
    it('GET :id — reads article')
    it('GET — lists articles')
    it('PATCH — updates article')
    it('DELETE — deletes article')
  }
  describe('permission boundary') {
    it('viewer cannot create article — INSUFFICIENT_PERMISSION')
  }
}
```

The unauthenticated block comes first — it verifies the auth gate before any authenticated behavior is tested.

---

## What API Integration Tests Cover

| Area | Approach |
|------|----------|
| Auth gate | Unauthenticated request to each route group returns 401 |
| Content CRUD | Full create → read → update → delete cycle per content type |
| Permission boundaries | At least one unauthorized role rejection per route group |
| Auth flow | Login → refresh → logout with real cookie inspection |
| Token invalidation | `token_version` mismatch after logout or role change |
| `must_change_password` | Blocked routes return `PASSWORD_CHANGE_REQUIRED` |
| Config endpoint | Returns sanitized config, no sensitive fields present |
| Schema endpoint | Returns full schema definitions matching test fixture |

---

## What API Integration Tests Do Not Cover

- JWT expiry (handled in auth-specific tests with clock mocking — see `phase-07-auth-tests.md`)
- Rate limiting beyond the happy path threshold (handled in auth-specific tests)
- Vue admin panel behavior (deferred to Phase 8)
- CLI command behavior (deferred to Phase 9)
