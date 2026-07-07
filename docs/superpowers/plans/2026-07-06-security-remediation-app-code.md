# Security Remediation (Application Code) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the application-code security findings from the 2026-07-06 audit (findings #1, #2, #3, #4, #5, #6, #8, #9, #11), each with a regression test, staying aligned with the existing ADRs.

**Architecture:** The two High findings live in the generated static-file server (`packages/cli/src/codegen/server-entries.ts`), where the logic is trapped in template strings and untestable. This plan extracts that security-critical logic into a real, unit-tested module at `packages/api/src/runtime/static.ts` (exposed via the existing `@bobbykim/manguito-cms-api/runtime` subpath export) and has the codegen emit imports of it — fixing the bug and the testability gap together. The remaining findings are localized fixes to the API package (auth, CORS, uploads, headers, authz) that follow patterns already in the codebase.

**Tech Stack:** TypeScript (strict), Hono middleware, Node `node:path`/`node:fs`, Vitest, `@aws-sdk/client-s3`. Packages touched: `core` (StorageAdapter interface, task 9 only), `api` (runtime, middleware, routes, storage), `cli` (codegen wiring).

**Source-of-truth references:**
- Findings: `docs/security/audit-2026-07-06.md`
- ADRs that bind decisions here: [api/0008 media upload security](../../adr/api/0008-media-upload-security.md), [api/0004 presigned-first storage](../../adr/api/0004-presigned-first-storage.md), [api/0003 hybrid JWT auth](../../adr/api/0003-hybrid-jwt-auth.md), [api/0005 in-process rate limiting](../../adr/api/0005-in-process-rate-limiting.md), [api/0002 public/admin split](../../adr/api/0002-public-admin-split.md), [0001 throw-vs-Result boundary](../../adr/0001-throw-vs-result-boundary.md), [0002 response envelope](../../adr/0002-response-envelope.md).

## Global Constraints

- TypeScript strict mode only; no JavaScript files. (CLAUDE.md)
- Layer boundaries: `core` imports nothing from db/api/admin/cli; `api` imports only from `core`+`db`; `cli` imports from all. `core` gains no new runtime dependency. (CLAUDE.md)
- Expected failures use the Result type / typed error responses — never throw for expected conditions ([ADR 0001]). HTTP errors use the `{ ok:false, error:{ code, message } }` envelope; success uses `{ ok:true, data }` ([ADR 0002], CLAUDE.md).
- `exactOptionalPropertyTypes` is on — add optional properties via conditional spread, never assign `undefined`.
- Factory functions over classes; named function declarations for top-level exports; arrow functions for callbacks. (CLAUDE.md)
- Untrusted user media must be served safely by **serving config, not sanitization** — SVG stays rejected at upload; the serve path forces non-renderable delivery for anything outside the image/video/pdf allowlist ([ADR api/0008]).
- Login limiting keeps **no per-account lockout** and the IP+email scope; spraying is mitigated by a global ceiling, matching the two-scope model of the `findAll` limiter ([ADR api/0005], amended in Task 4).
- Publishing is gated by `content:edit` on every surface, not a separate permission ([ADR api/0002]).

---

### Task 1: Extract testable static-serving helper and fix admin path traversal (Finding #1)

**Files:**
- Create: `packages/api/src/runtime/static.ts`
- Modify: `packages/api/src/runtime/index.ts`
- Test: `packages/api/src/runtime/__tests__/static.test.ts` (create)
- Modify (codegen wiring, done in Task 2's commit boundary): deferred — Task 1 lands the tested helper; Task 2 wires both the admin and uploads codegen paths to it.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `resolveStaticFile(baseDir: string, urlSubPath: string): string | null` — resolves `urlSubPath` (the request path already stripped of its route prefix, may start with `/`) against `baseDir`, returning the absolute path **iff it stays inside `baseDir`**, else `null`. Pure, no I/O.
  - `SAFE_INLINE_MIME: Record<string,string>` and `ADMIN_MIME: Record<string,string>` (exported for Task 2).

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/runtime/__tests__/static.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { resolveStaticFile } from '../static'

const BASE = resolve('/srv/app/admin')

describe('resolveStaticFile', () => {
  it('resolves a normal nested asset inside the base dir', () => {
    expect(resolveStaticFile(BASE, '/assets/app.js')).toBe(resolve(BASE, 'assets/app.js'))
  })

  it('resolves the root to the base dir itself', () => {
    expect(resolveStaticFile(BASE, '/')).toBe(BASE)
  })

  it('rejects parent-dir traversal', () => {
    expect(resolveStaticFile(BASE, '/../../../etc/passwd')).toBeNull()
  })

  it('rejects traversal that resolves to a sibling prefix', () => {
    // /srv/app/admin-secret must not be reachable from /srv/app/admin
    expect(resolveStaticFile(BASE, '/../admin-secret/x')).toBeNull()
  })

  it('rejects an embedded traversal segment', () => {
    expect(resolveStaticFile(BASE, '/assets/../../secret.env')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test static.test`
Expected: FAIL — cannot find module `../static`.

- [ ] **Step 3: Implement the helper**

Create `packages/api/src/runtime/static.ts`:

```typescript
import { resolve, sep } from 'node:path'

/**
 * Resolve a request sub-path against a base directory, returning the absolute
 * path only when it stays inside baseDir. Returns null for any path that
 * escapes (traversal, sibling-prefix). Pure — performs no filesystem access.
 */
export function resolveStaticFile(baseDir: string, urlSubPath: string): string | null {
  const base = resolve(baseDir)
  const rel = urlSubPath.startsWith('/') ? '.' + urlSubPath : './' + urlSubPath
  const candidate = resolve(base, rel)
  if (candidate === base || candidate.startsWith(base + sep)) {
    return candidate
  }
  return null
}

/** Extensions safe to serve inline for untrusted user uploads (Finding #2). */
export const SAFE_INLINE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
}

/** MIME map for trusted, build-produced admin SPA assets. */
export const ADMIN_MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript',
  mjs: 'application/javascript',
  css: 'text/css',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  webp: 'image/webp',
}
```

- [ ] **Step 4: Export from the runtime barrel**

In `packages/api/src/runtime/index.ts`, add after the existing exports:

```typescript
export { resolveStaticFile, SAFE_INLINE_MIME, ADMIN_MIME } from './static.js'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test static.test`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck + build the api package** (so the `/runtime` subpath dist exists for the codegen in Task 2)

Run: `pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit && pnpm --filter @bobbykim/manguito-cms-api build`
Expected: no type errors; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/runtime/static.ts packages/api/src/runtime/index.ts packages/api/src/runtime/__tests__/static.test.ts
git commit -m "feat(api): add tested static-file containment + safe-mime helpers"
```

---

### Task 2: Wire codegen static serving to the safe helpers (Findings #1, #2)

**Files:**
- Modify: `packages/cli/src/codegen/server-entries.ts` (the node `serverEntry` uploads + admin blocks, and the shared `adminStaticRoute`)
- Test: `packages/cli/tests/server-entries.test.ts` (extend the existing file from the rate-limit work)

**Interfaces:**
- Consumes: `resolveStaticFile`, `SAFE_INLINE_MIME`, `ADMIN_MIME` from `@bobbykim/manguito-cms-api/runtime` (Task 1).
- Produces: nothing.

**Context:** Three generated handlers must change: (a) the node `serverEntry` `/uploads/` block (`server-entries.ts:110-124`), (b) the node `serverEntry` admin block (`:127-144`), (c) the shared `adminStaticRoute` used by Lambda/Vercel (`:191-208`). All three currently do `resolve(adminDir, '.' + rel)` / hand-rolled traversal handling and derive the served Content-Type from the file extension. Route all of them through the helpers.

- [ ] **Step 1: Write the failing test**

In `packages/cli/tests/server-entries.test.ts`, add:

```typescript
import { appSetup } from '../src/codegen/server-entries.js'
// (existing imports/tests remain)

describe('static serving hardening (codegen)', () => {
  it('admin + uploads handlers import the shared runtime helpers', () => {
    const src = appSetup()
    // appSetup does not itself contain the handlers; assert the module wiring
    // instead — see generateServerEntries output test below.
    expect(src).toContain("@bobbykim/manguito-cms-api")
  })
})
```

> Note: `appSetup()` returns only the shared preamble. The generated *handlers* live in `serverEntry`/`adminStaticRoute`, which are not currently exported. Export them (Step 3) so the test can assert on them directly.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test server-entries`
Expected: FAIL — `serverEntry`/`adminStaticRoute` not exported (once Step 3's assertions are added).

- [ ] **Step 3: Replace the assertions with the real contract and export the builders**

In `packages/cli/src/codegen/server-entries.ts` change `function serverEntry(` → `export function serverEntry(` and `function adminStaticRoute(` → `export function adminStaticRoute(`. Then replace the test body from Step 1 with:

```typescript
import { serverEntry, adminStaticRoute } from '../src/codegen/server-entries.js'

describe('static serving hardening (codegen)', () => {
  const node = serverEntry({ adminPrefix: '/admin', apiPrefix: '/api' })
  const shared = adminStaticRoute('/admin')

  it('imports the shared runtime helpers instead of a local MIME map', () => {
    expect(node).toContain("from '@bobbykim/manguito-cms-api/runtime'")
    expect(shared).toContain("from '@bobbykim/manguito-cms-api/runtime'")
  })

  it('admin handlers use resolveStaticFile for containment (no bare resolve+.+rel)', () => {
    expect(node).toContain('resolveStaticFile(adminDir')
    expect(shared).toContain('resolveStaticFile(adminDir')
    expect(node).not.toContain("resolve(adminDir, '.' + rel)")
    expect(shared).not.toContain("resolve(adminDir, '.' + rel)")
  })

  it('uploads are served from the safe-inline allowlist and forced to attachment otherwise', () => {
    expect(node).toContain('SAFE_INLINE_MIME')
    expect(node).toContain("Content-Disposition")
  })
})
```

- [ ] **Step 4: Update the node `serverEntry` uploads block**

In `server-entries.ts`, replace the `/uploads/` block (currently `server-entries.ts:110-124`) with a version that uses containment + the safe allowlist. The generated code becomes:

```javascript
  // ── Uploads (local storage) — untrusted user content, served safely ─────────
  if (path.startsWith('/uploads/')) {
    const filePath = resolveStaticFile(uploadsDir, path.slice('/uploads'.length))
    if (!filePath) { res.statusCode = 403; res.end('Forbidden'); return }
    try {
      const data = await readFile(filePath)
      const ext = extname(filePath).slice(1).toLowerCase()
      const inline = SAFE_INLINE_MIME[ext]
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (inline) {
        res.setHeader('Content-Type', inline)
      } else {
        // Non-allowlisted extension (e.g. .html, .svg): never render inline.
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Content-Disposition', 'attachment')
      }
      res.end(data)
    } catch { res.statusCode = 404; res.end('Not found') }
    return
  }
```

- [ ] **Step 5: Update the node `serverEntry` admin block**

Replace the admin block (currently `:127-144`) with:

```javascript
  // ── Admin SPA ────────────────────────────────────────────────────────────────
  if (path.startsWith(ADMIN_PREFIX)) {
    const resolved = resolveStaticFile(adminDir, path.slice(ADMIN_PREFIX.length) || '/')
    let filePath = resolved ?? resolve(adminDir, 'index.html')
    try {
      const s = await stat(filePath)
      if (!s.isFile()) filePath = resolve(adminDir, 'index.html')
    } catch {
      filePath = resolve(adminDir, 'index.html')
    }
    try {
      const data = await readFile(filePath)
      res.setHeader('Content-Type', ADMIN_MIME[extname(filePath).slice(1).toLowerCase()] ?? 'application/octet-stream')
      res.end(data)
    } catch { res.statusCode = 404; res.end('Not found') }
    return
  }
```

Add the import to the node server preamble (the `serverEntry` template, near its existing `import { resolve, extname } from 'node:path'`):

```javascript
import { resolveStaticFile, SAFE_INLINE_MIME, ADMIN_MIME } from '@bobbykim/manguito-cms-api/runtime'
```

and delete the now-unused inline `MIME` map object in that template (the constant at `:56-71`); uploads use `SAFE_INLINE_MIME`, admin uses `ADMIN_MIME`.

- [ ] **Step 6: Update the shared `adminStaticRoute`**

In `adminStaticRoute` replace the handler body (`:191-208`) with:

```javascript
import { resolveStaticFile, ADMIN_MIME } from '@bobbykim/manguito-cms-api/runtime'
// (drop the local ADMIN_MIME object literal at :174-189)

app.get(\`\${ADMIN_PREFIX}/*\`, async (c) => {
  const resolved = resolveStaticFile(adminDir, c.req.path.slice(ADMIN_PREFIX.length) || '/')
  let filePath = resolved ?? resolve(adminDir, 'index.html')
  try {
    const s = await stat(filePath)
    if (!s.isFile()) filePath = resolve(adminDir, 'index.html')
  } catch {
    filePath = resolve(adminDir, 'index.html')
  }
  try {
    const data = await readFile(filePath)
    return new Response(data, {
      headers: { 'Content-Type': ADMIN_MIME[extname(filePath).slice(1).toLowerCase()] ?? 'application/octet-stream' },
    })
  } catch {
    return c.text('Not found', 404)
  }
})
```

- [ ] **Step 7: Run the codegen test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test server-entries`
Expected: PASS.

- [ ] **Step 8: Typecheck the cli package**

Run: `pnpm --filter @bobbykim/manguito-cms-cli exec tsc --noEmit`
Expected: no type errors.

- [ ] **Step 9: Update ADR api/0008 consequences**

In `docs/adr/api/0008-media-upload-security.md`, under Consequences, append:

```markdown
- **Amendment (2026-07, security round):** The local `/uploads` server now serves only an image/video/pdf inline allowlist (`SAFE_INLINE_MIME`); any other extension (including `.html`/`.svg`) is served `application/octet-stream` + `Content-Disposition: attachment`, closing the stored-XSS gap where a `.html` filename produced an explicit `text/html` response that the `octet-stream`-only attachment rule did not cover. Static-file containment and safe-MIME logic moved to the tested `@bobbykim/manguito-cms-api/runtime` `resolveStaticFile`/`SAFE_INLINE_MIME` helpers.
```

- [ ] **Step 10: Commit**

```bash
git add packages/cli/src/codegen/server-entries.ts packages/cli/tests/server-entries.test.ts docs/adr/api/0008-media-upload-security.md
git commit -m "fix(cli): harden generated static serving — traversal guard + safe upload MIME

Findings #1 (admin path traversal) and #2 (stored XSS via upload extension).
Routes all three generated static handlers through the tested runtime helpers.
Refs docs/security/audit-2026-07-06.md, ADR api/0008."
```

---

### Task 3: Equalize login timing to close user enumeration (Finding #3)

**Files:**
- Modify: `packages/api/src/routes/admin/auth.ts` (login handler, `:100-109`)
- Test: `packages/api/src/routes/__tests__/auth.test.ts` (existing) or a new focused test

**Interfaces:**
- Consumes: `verifyPassword` (already imported in `auth.ts`).
- Produces: nothing.

**Context:** On the user-not-found path the handler returns before running bcrypt; an existing user runs a cost-12 compare. Run a compare against a fixed dummy hash on the not-found path so both paths pay the bcrypt cost. Aligns with the hand-rolled auth strategy in [ADR api/0003].

- [ ] **Step 1: Write the failing test**

In `packages/api/src/routes/__tests__/auth.test.ts` (add to the existing suite; if the file mocks `verifyPassword`, assert it is invoked even when the user is absent). Add:

```typescript
import { verifyPassword } from '../../auth/password'
// vi.mock('../../auth/password', ...) as the existing suite does

it('runs a password comparison even when the email does not exist (no timing oracle)', async () => {
  // Arrange: DB returns no user row for the email.
  // (use the suite's existing db mock/harness to return zero rows)
  const spy = vi.mocked(verifyPassword)
  spy.mockClear()

  await app.request('/admin/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'whatever' }),
  })

  expect(spy).toHaveBeenCalledTimes(1) // dummy compare ran despite no user
})
```

> If the existing test harness uses a real DB (integration), instead assert the response is `401 INVALID_CREDENTIALS` for a non-existent email AND, in a unit test of a small extracted helper, that a comparison runs. Prefer the mock approach if the suite already mocks `verifyPassword`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test auth.test`
Expected: FAIL — `verifyPassword` called 0 times on the not-found path.

- [ ] **Step 3: Add the dummy-hash comparison**

In `auth.ts`, add a module-level constant near the rate-limit constants (a real bcrypt hash of a random string; cost 12 to match `SALT_ROUNDS`):

```typescript
// A valid cost-12 bcrypt hash used only to equalize timing on the
// user-not-found path, so login response time cannot enumerate accounts.
const DUMMY_PASSWORD_HASH =
  '$2a$12$k8Y1oR2m3n4p5q6r7s8t9uO0wXyZaBcDeFgHiJkLmNoPqRsTuVwX2'
```

Then change the not-found branch (`:102-104`) to run a comparison first:

```typescript
    if (!user) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH)
      return c.json(invalidCredentials, 401)
    }
```

> The exact hash string must be a real bcrypt hash. During implementation, generate one with `node -e "console.log(require('bcryptjs').hashSync('x',12))"` and paste the output verbatim (bcryptjs is already a dependency via core). A malformed hash makes `verifyPassword` resolve `false` quickly, defeating the timing fix — verify the generated string starts with `$2a$12$` and is 60 chars.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test auth.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/admin/auth.ts packages/api/src/routes/__tests__/auth.test.ts
git commit -m "fix(api): equalize login timing on unknown email (Finding #3)"
```

---

### Task 4: Add a global login-attempt ceiling (Finding #5)

**Files:**
- Modify: `packages/api/src/routes/admin/auth.ts` (`checkRateLimit`, `:18-37`, and its call site `:81`)
- Modify: `docs/adr/api/0005-in-process-rate-limiting.md`
- Test: `packages/api/src/routes/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `checkRateLimit(key)` unchanged signature; adds an internal global ceiling.

**Context:** Per [ADR api/0005] the login limiter deliberately keeps **no per-account lockout** and an IP+email scope (to protect shared-NAT users and avoid a lockout DoS). This adds a *global* attempt ceiling across all keys — mirroring the two-scope model the `findAll` limiter already uses — so distributed email-spraying hits a ceiling without introducing per-user lockout.

- [ ] **Step 1: Write the failing test**

In `auth.test.ts` add:

```typescript
it('applies a global login-attempt ceiling across distinct emails', async () => {
  // GLOBAL_LOGIN_MAX is 100. Fire >100 login attempts across unique emails
  // from unique IPs so neither the per-(ip,email) bucket trips; the global
  // ceiling must eventually return 429.
  let saw429 = false
  for (let i = 0; i < 105; i++) {
    const res = await app.request('/admin/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.${i}.1` },
      body: JSON.stringify({ email: `u${i}@example.com`, password: 'x' }),
    })
    if (res.status === 429) { saw429 = true; break }
  }
  expect(saw429).toBe(true)
})
```

> If suites share module state across tests (the `loginAttempts` map is module-level), place this test in its own file or reset state; note the reset approach in the test.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test auth.test`
Expected: FAIL — no global ceiling; all attempts across unique keys return 401, never 429.

- [ ] **Step 3: Implement the global ceiling**

In `auth.ts`, add a global window alongside the per-key map and check it in `checkRateLimit`:

```typescript
const loginAttempts = new Map<string, number[]>()
const globalLoginAttempts: number[] = []

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
// Global backstop across all IPs/emails — blunts distributed spraying without
// per-account lockout (ADR api/0005). Sized well above legitimate concurrent
// login volume for a self-hosted CMS.
const GLOBAL_LOGIN_MAX = 100

function checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS

  // Global ceiling first — purge, then evaluate before recording the per-key hit.
  while (globalLoginAttempts.length > 0 && globalLoginAttempts[0]! <= windowStart) {
    globalLoginAttempts.shift()
  }
  if (globalLoginAttempts.length >= GLOBAL_LOGIN_MAX) {
    const retryAfterSeconds = Math.ceil((globalLoginAttempts[0]! + RATE_LIMIT_WINDOW_MS - now) / 1000)
    return { allowed: false, retryAfterSeconds }
  }

  const attempts = (loginAttempts.get(key) ?? []).filter((t) => t > windowStart)
  attempts.push(now)
  loginAttempts.set(key, attempts)
  globalLoginAttempts.push(now)

  if (attempts.length > RATE_LIMIT_MAX) {
    const oldestInWindow = attempts[0]!
    const retryAfterSeconds = Math.ceil((oldestInWindow + RATE_LIMIT_WINDOW_MS - now) / 1000)
    return { allowed: false, retryAfterSeconds }
  }

  return { allowed: true, retryAfterSeconds: 0 }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test auth.test`
Expected: PASS (new global-ceiling test plus the existing per-key tests).

- [ ] **Step 5: Amend ADR api/0005**

In `docs/adr/api/0005-in-process-rate-limiting.md`, under Consequences, append:

```markdown
- **Amendment (2026-07, security round):** login now also enforces a global
  attempt ceiling (`GLOBAL_LOGIN_MAX`, 15-min window) across all IP+email keys,
  matching the two-scope (per-key + global) model of the `findAll` limiter. This
  blunts distributed email-spraying (audit Finding #5) while preserving the
  no-account-lockout decision. Like all in-process state, the global ceiling is
  per-instance on serverless; Redis-backed global limiting remains the v2 path.
```

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/admin/auth.ts packages/api/src/routes/__tests__/auth.test.ts docs/adr/api/0005-in-process-rate-limiting.md
git commit -m "feat(api): add global login-attempt ceiling (Finding #5)

Preserves ADR api/0005's no-lockout decision; adds a global backstop.
Amends ADR api/0005."
```

---

### Task 5: Remove the no-op auth/permission shims (Finding #6)

**Files:**
- Modify: `packages/api/src/middleware/auth.ts` (delete `:89-92` shims)
- Modify: `packages/api/src/routes/admin/content.ts` (import + default-param at `:28`, `:172`; drop route-level `requireAuth` usages)
- Modify: `packages/api/src/routes/admin/media.ts` (import `:5`; drop route-level `requireAuth` usages)
- Test: `packages/api/src/routes/__tests__/*` — rely on existing admin auth integration tests; add one asserting a missing `requirePermission` is a compile-time/hard error (see Step 1)

**Interfaces:**
- Consumes: `createPermissionMiddleware` result, passed from `app.ts` (unchanged).
- Produces: `registerAdminContentRoutes(...)` — `requirePermission` parameter becomes **required** (no default).

**Context:** The real `authMiddleware` is blanket-applied at `app.ts:150` and the real `requirePermission` is passed at `app.ts:214-216`, so the shims are dead but dangerous (a missing arg silently disables permission checks). [ADR api/0003] documents the real middleware chain; remove the shims so the code fails closed.

- [ ] **Step 1: Write the failing test**

The strongest guard is types: making `requirePermission` required means a call without it fails `tsc`. Add a behavioral test that the redundant route-level auth is gone and permission is still enforced — reuse the existing admin integration harness. In `packages/api/src/__tests__/admin.integration.test.ts` (or the content admin test), add:

```typescript
it('rejects an unauthenticated admin content write with 401', async () => {
  const res = await app.request('/admin/api/<some-base-path>', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'x' }),
  })
  expect(res.status).toBe(401) // blanket authMiddleware, not the removed shim
})
```

> Use the base path already registered by the integration harness. This proves protection survives removal of the route-level `requireAuth`.

- [ ] **Step 2: Run to verify current state**

Run: `pnpm --filter @bobbykim/manguito-cms-api test admin.integration`
Expected: the new test PASSES already (blanket auth covers it) — it is a regression guard, not red-first here. Record its pass; the red-first signal for this task is the `tsc` error in Step 4 before call sites are updated.

- [ ] **Step 3: Delete the shims**

In `packages/api/src/middleware/auth.ts`, delete the block (`:87-92`):

```typescript
// Phase 5 compatibility shims — in use by routes/admin/content.ts and
// routes/admin/media.ts until route wiring is completed in Phase 6.
export const requireAuth: MiddlewareHandler = async (_c, next) => next()
export function requirePermission(_permission: string): MiddlewareHandler {
  return async (_c, next) => next()
}
```

- [ ] **Step 4: Update `content.ts`**

- Change the import at `:28` from
  `import { requireAuth, requirePermission as requirePermissionShim } from '../../middleware/auth.js'`
  to remove both (delete the line).
- Change the parameter at `:172` from
  `requirePermission: ReturnType<typeof createPermissionMiddleware> = requirePermissionShim,`
  to
  `requirePermission: ReturnType<typeof createPermissionMiddleware>,`
  (required, no default).
- Remove every route-level `requireAuth,` argument in the `app.get/post/patch/...(` calls in this file (e.g. `:214, :248, :298, :452, :593, :666, :700, :720, :779, :861, :899`). The blanket `authMiddleware` (`app.ts:150`) already enforces auth. Leave the `requirePermission('...')` middleware in place.

Run `tsc` now to surface the required-arg check:

Run: `pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit`
Expected: PASS if `app.ts:215` already passes `requirePermission` (it does). This is the red→green boundary — the required param is now enforced.

- [ ] **Step 5: Update `media.ts`**

- Delete the import at `:5` (`import { requireAuth } from '../../middleware/auth.js'`).
- Remove every route-level `requireAuth,` argument (`:204, :214, :224, :232, :330, :381, :415, :472, :522`). Keep `requirePermission('...')`.

- [ ] **Step 6: Run the admin integration tests + typecheck**

Run: `pnpm --filter @bobbykim/manguito-cms-api test admin.integration && pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit`
Expected: PASS — auth still enforced (401 on unauth), permissions still enforced (403), no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/middleware/auth.ts packages/api/src/routes/admin/content.ts packages/api/src/routes/admin/media.ts packages/api/src/__tests__/admin.integration.test.ts
git commit -m "refactor(api): remove no-op auth/permission shims (Finding #6)

Makes requirePermission a required parameter so routes fail closed.
Blanket authMiddleware already enforces authn. Refs ADR api/0003."
```

---

### Task 6: Gate publish-on-create behind `content:edit` (Finding #11)

**Files:**
- Modify: `packages/api/src/routes/admin/content.ts` (create handler, before building `columnData` at `:386`)
- Test: `packages/api/src/__tests__/*content*integration*` (existing admin content integration suite)

**Interfaces:**
- Consumes: `requirePermission` (now required — Task 5).
- Produces: nothing.

**Context:** [ADR api/0002] states publishing is gated by `content:edit` on every surface. The update path already enforces this (`content.ts:511-513`); the create path sets `published` from the body with no such check. Mirror the update-path check.

- [ ] **Step 1: Write the failing test**

In the admin content integration suite, add a test using a role that has `content:create` but not `content:edit`:

```typescript
it('forbids creating already-published content without content:edit', async () => {
  const res = await authenticatedRequest(app, 'writer', 'POST', '/admin/api/<base-path>', {
    body: { slug: 'draft-attempt', published: true },
  })
  expect(res.status).toBe(403)
  const json = await res.json() as { ok: boolean; error: { code: string } }
  expect(json.error.code).toBe('INSUFFICIENT_PERMISSION')
})
```

> Choose a `TestRole` from the harness that has `content:create` but lacks `content:edit`; if none exists in the fixtures, use the role the harness designates for create-only. Confirm the role's permission set in the test fixtures before finalizing the role name.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test content` (the admin content integration file)
Expected: FAIL — create with `published:true` returns 201, not 403.

- [ ] **Step 3: Add the publish gate to the create handler**

In `content.ts`, in the create handler (`app.post(`/admin/api/${basePath}`, ...)`), immediately after the required-fields check passes and **before** `// Classify fields` (`:377`), add — mirroring the update path (`:511-513`):

```typescript
        if (body['published'] === true) {
          const publishDeny = await requirePermission('content:edit')(c, async () => {})
          if (publishDeny) return publishDeny
        }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test content`
Expected: PASS — create-with-publish is 403 without `content:edit`; a role with `content:edit` still succeeds (existing tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/admin/content.ts packages/api/src/__tests__/
git commit -m "fix(api): gate publish-on-create behind content:edit (Finding #11)

Aligns create with the update path and ADR api/0002."
```

---

### Task 7: Honor configured CORS origin and scope credentials (Finding #4)

**Files:**
- Modify: `packages/api/src/middleware/cors.ts`
- Modify: `packages/api/src/app.ts` (`CreateCmsAppOptions`, the `createCorsMiddleware` call at `:71`)
- Modify: `packages/cli/src/commands/dev.ts` and `packages/cli/src/codegen/server-entries.ts` (thread `config.server.cors` into `createCmsApp`, same pattern as `rateLimit`)
- Test: `packages/api/src/middleware/__tests__/cors.test.ts` (create)

**Interfaces:**
- Consumes: `CorsConfig` from `@bobbykim/manguito-cms-core` (existing).
- Produces: `CreateCmsAppOptions.cors?: CorsConfig`; a request-Origin-validating CORS middleware.

**Context:** `app.ts:71` hardcodes `origin: '*'` and the middleware unconditionally sets `Access-Control-Allow-Credentials: true`. The fix: reflect a single request `Origin` only when it matches the configured allowlist, and only send credentials for a concrete (non-`*`) allowed origin. Thread the user's `server.cors` config through, mirroring the `rateLimit` wiring already in `app.ts`/`dev.ts`/`server-entries.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/middleware/__tests__/cors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createCorsMiddleware } from '../cors'

function appWith(cors: Parameters<typeof createCorsMiddleware>[0]) {
  const app = new Hono()
  app.use('*', createCorsMiddleware(cors))
  app.get('/x', (c) => c.json({ ok: true }))
  return app
}

describe('createCorsMiddleware', () => {
  it('reflects an allowed origin and sets credentials for a concrete origin', async () => {
    const app = appWith({ origin: 'https://app.example.com', credentials: true })
    const res = await app.request('/x', { headers: { origin: 'https://app.example.com' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('does not reflect a non-allowed origin', async () => {
    const app = appWith({ origin: 'https://app.example.com', credentials: true })
    const res = await app.request('/x', { headers: { origin: 'https://evil.example.com' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example.com')
  })

  it('with wildcard origin, never sends credentials', async () => {
    const app = appWith({ origin: '*' })
    const res = await app.request('/x', { headers: { origin: 'https://anything.example.com' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test cors.test`
Expected: FAIL — current middleware always sets credentials and does not validate the request Origin.

- [ ] **Step 3: Rewrite the CORS middleware**

Replace `packages/api/src/middleware/cors.ts` with:

```typescript
import type { MiddlewareHandler } from 'hono'
import type { CorsConfig } from '@bobbykim/manguito-cms-core'

export function createCorsMiddleware(corsConfig: CorsConfig): MiddlewareHandler {
  const allowList = Array.isArray(corsConfig.origin)
    ? corsConfig.origin
    : [corsConfig.origin]
  const wildcard = allowList.includes('*')
  const methods = corsConfig.methods?.join(',') ?? 'GET,POST,PATCH,DELETE,OPTIONS'

  return async function corsMiddleware(c, next) {
    if (corsConfig.enabled === false) {
      return next()
    }

    const requestOrigin = c.req.header('origin')

    if (wildcard) {
      // Wildcard cannot be combined with credentials per the CORS spec.
      c.res.headers.set('Access-Control-Allow-Origin', '*')
    } else if (requestOrigin && allowList.includes(requestOrigin)) {
      c.res.headers.set('Access-Control-Allow-Origin', requestOrigin)
      c.res.headers.set('Vary', 'Origin')
      if (corsConfig.credentials === true) {
        c.res.headers.set('Access-Control-Allow-Credentials', 'true')
      }
    }
    // Non-matching origins: emit no Allow-Origin (browser blocks the read).

    c.res.headers.set('Access-Control-Allow-Methods', methods)
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (c.req.method === 'OPTIONS') {
      return c.newResponse(null, 204)
    }
    return next()
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test cors.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Thread `cors` into `createCmsApp`**

In `packages/api/src/app.ts`:
- Add `cors?: CorsConfig` to `CreateCmsAppOptions` (import `CorsConfig` from core on the existing core import line).
- Destructure `cors` in the options destructure (`:67`).
- Replace the hardcoded `:71`:
  ```typescript
  app.use('*', createCorsMiddleware(cors ?? { origin: '*', enabled: true }))
  ```

- [ ] **Step 6: Forward `config.server.cors` at both call sites**

In `packages/cli/src/commands/dev.ts`, add to **both** `createCmsApp({...})` calls (mirroring the `rateLimit` line added earlier):

```typescript
    ...(config.server?.cors ? { cors: config.server.cors } : {}),
```

In `packages/cli/src/codegen/server-entries.ts`, `appSetup()` generated `createCmsApp({...})`, add after the `rateLimit` line:

```javascript
  ...(config.server?.cors ? { cors: config.server.cors } : {}),
```

Extend `packages/cli/tests/server-entries.test.ts` with an assertion:

```typescript
it('threads config.server.cors into the generated createCmsApp call', () => {
  expect(appSetup()).toContain('config.server?.cors ? { cors: config.server.cors }')
})
```

- [ ] **Step 7: Run cli tests + typecheck both packages**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test server-entries && pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit && pnpm --filter @bobbykim/manguito-cms-cli exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/middleware/cors.ts packages/api/src/middleware/__tests__/cors.test.ts packages/api/src/app.ts packages/cli/src/commands/dev.ts packages/cli/src/codegen/server-entries.ts packages/cli/tests/server-entries.test.ts
git commit -m "fix(api,cli): validate CORS origin and scope credentials (Finding #4)

Honors server.cors config; reflects a single allowed origin; only sends
Allow-Credentials for a concrete origin. Threads cors through createCmsApp."
```

---

### Task 8: Add a security-headers middleware (Finding #9)

**Files:**
- Create: `packages/api/src/middleware/security-headers.ts`
- Modify: `packages/api/src/app.ts` (apply globally, before routes)
- Test: `packages/api/src/middleware/__tests__/security-headers.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `createSecurityHeadersMiddleware(): MiddlewareHandler`.

**Context:** No CSP / `X-Frame-Options` / `Referrer-Policy` are emitted. Add conservative headers globally; a strict CSP shrinks the blast radius of any residual XSS (defense-in-depth for Finding #2). Keep the CSP permissive enough for the admin SPA (self scripts/styles) — the SPA is same-origin.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/middleware/__tests__/security-headers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createSecurityHeadersMiddleware } from '../security-headers'

describe('createSecurityHeadersMiddleware', () => {
  it('sets the core security headers on responses', async () => {
    const app = new Hono()
    app.use('*', createSecurityHeadersMiddleware())
    app.get('/x', (c) => c.json({ ok: true }))
    const res = await app.request('/x')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test security-headers`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the middleware**

Create `packages/api/src/middleware/security-headers.ts`:

```typescript
import type { MiddlewareHandler } from 'hono'

// Conservative defaults. CSP allows same-origin scripts/styles for the admin
// SPA (served same-origin) and blocks framing; tighten per deployment as needed.
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export function createSecurityHeadersMiddleware(): MiddlewareHandler {
  return async function securityHeaders(c, next) {
    await next()
    c.res.headers.set('X-Content-Type-Options', 'nosniff')
    c.res.headers.set('X-Frame-Options', 'DENY')
    c.res.headers.set('Referrer-Policy', 'no-referrer')
    c.res.headers.set('Content-Security-Policy', CSP)
  }
}
```

- [ ] **Step 4: Apply it globally in `app.ts`**

In `packages/api/src/app.ts`, import it and register **first**, before the CORS middleware (`:71`):

```typescript
import { createSecurityHeadersMiddleware } from './middleware/security-headers.js'
// ...
app.use('*', createSecurityHeadersMiddleware())
app.use('*', createCorsMiddleware(cors ?? { origin: '*', enabled: true }))
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @bobbykim/manguito-cms-api test security-headers && pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/middleware/security-headers.ts packages/api/src/middleware/__tests__/security-headers.test.ts packages/api/src/app.ts
git commit -m "feat(api): add security-headers middleware — CSP, X-Frame-Options (Finding #9)"
```

---

### Task 9: Validate presigned upload size and content type on confirm (Finding #8)

**Files:**
- Modify: `packages/core/src/config/types.ts` (add optional `stat` to `StorageAdapter`)
- Modify: `packages/api/src/storage/adapters/s3.ts` and `packages/api/src/storage/adapters/local.ts` (implement `stat`)
- Modify: `packages/api/src/routes/admin/media.ts` (confirm handler `:330-378`)
- Modify: `docs/adr/api/0004-presigned-first-storage.md` (record the confirm-time validation)
- Test: `packages/api/src/storage/adapters/__tests__/*` and the media confirm integration test

**Interfaces:**
- Consumes: `maxFileSize` (already threaded into `registerAdminMediaRoutes` as `maxFileSize`), the accepted MIME sets in `media.ts`.
- Produces: `StorageAdapter.stat?(key: string): Promise<{ size: number; content_type?: string } | null>` (optional — adapters that cannot cheaply introspect omit it, and confirm skips enforcement for them).

**Context:** [ADR api/0004] and [ADR api/0008] both flag that presigned uploads are not size-bounded and defer it to "the pre-release security round" (this plan). The confirm handler currently trusts the token's `mime_type` and records `file_size: 0`. Add an optional `stat` so confirm can (a) reject oversized objects, (b) reject a stored content-type outside the accepted set, and (c) record the real `file_size`. Optional method keeps Cloudinary (no cheap stat) working — enforcement applies where `stat` exists.

- [ ] **Step 1: Write the failing adapter test (local)**

Create `packages/api/src/storage/adapters/__tests__/local-stat.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createLocalAdapter } from '../local'

describe('local adapter stat', () => {
  it('returns null for a missing key', async () => {
    const adapter = createLocalAdapter()
    expect(await adapter.stat?.('image/does-not-exist.png')).toBeNull()
  })

  it('returns size for an uploaded key', async () => {
    const adapter = createLocalAdapter()
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    await adapter.upload?.('image/stat-test.png', bytes, 'image/png')
    const meta = await adapter.stat?.('image/stat-test.png')
    expect(meta?.size).toBe(5)
    await adapter.delete('image/stat-test.png')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test local-stat`
Expected: FAIL — `stat` is not a function.

- [ ] **Step 3: Add `stat` to the interface and implement it**

In `packages/core/src/config/types.ts`, add to the `StorageAdapter` interface (after `upload?`):

```typescript
  /** Optional metadata lookup used to validate uploaded objects on confirm. */
  stat?(key: string): Promise<{ size: number; content_type?: string } | null>
```

In `packages/api/src/storage/adapters/local.ts`, add to the returned object (using the same `upload_dir` the adapter already resolves):

```typescript
    async stat(key: string): Promise<{ size: number; content_type?: string } | null> {
      const { stat } = await import('node:fs/promises')
      const filepath = path.join(upload_dir, key.startsWith('uploads/') ? key.slice('uploads/'.length) : key)
      try {
        const s = await stat(filepath)
        return { size: s.size }
      } catch {
        return null
      }
    },
```

In `packages/api/src/storage/adapters/s3.ts`, add (using `HeadObjectCommand` from `@aws-sdk/client-s3`):

```typescript
    async stat(key: string): Promise<{ size: number; content_type?: string } | null> {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return {
          size: head.ContentLength ?? 0,
          ...(head.ContentType !== undefined && { content_type: head.ContentType }),
        }
      } catch {
        return null
      }
    },
```

Add `HeadObjectCommand` to the existing `@aws-sdk/client-s3` import in `s3.ts`.

- [ ] **Step 4: Run the adapter test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test local-stat`
Expected: PASS.

- [ ] **Step 5: Write the failing confirm-validation test**

In the media confirm integration/unit test, add a case: a pending upload whose object exceeds `maxFileSize` is rejected `413 FILE_TOO_LARGE` and the object is deleted. Use a `maxFileSize` small enough to trip against a stubbed `stat`. If the suite uses the local adapter, upload an oversized buffer to the pending key, then call confirm:

```typescript
it('rejects confirm when the uploaded object exceeds max_file_size', async () => {
  // presign → upload oversized bytes to the returned key → confirm
  // expect 413 with error.code === 'FILE_TOO_LARGE'
  // (build the app with media.max_file_size set small, e.g. 4)
})
```

> Fill in with the suite's presign→upload→confirm helper; the assertion is `res.status === 413` and `error.code === 'FILE_TOO_LARGE'`.

- [ ] **Step 6: Add the confirm-time validation**

In `media.ts` confirm handler, after `verifyPendingUpload` succeeds and before `storage.getUrl(pending.key)` (`:363`), insert:

```typescript
    // Validate the actual uploaded object where the adapter supports it.
    let fileSize = 0
    if (storage.stat) {
      const meta = await storage.stat(pending.key)
      if (!meta) {
        return c.json(
          { ok: false, error: { code: 'STORAGE_ERROR', message: 'Uploaded object not found' } },
          502,
        )
      }
      const accepted =
        pending.folder === 'image' ? IMAGE_MIME_TYPES
        : pending.folder === 'video' ? VIDEO_MIME_TYPES
        : FILE_MIME_TYPES
      if (meta.content_type && !accepted.has(meta.content_type)) {
        await storage.delete(pending.key)
        return c.json(
          { ok: false, error: { code: 'UNSUPPORTED_MIME_TYPE', message: `Stored object type '${meta.content_type}' is not accepted` } },
          415,
        )
      }
      if (maxFileSize !== undefined && meta.size > maxFileSize) {
        await storage.delete(pending.key)
        return c.json(
          { ok: false, error: { code: 'FILE_TOO_LARGE', message: `Uploaded file exceeds the ${maxFileSize} byte limit` } },
          413,
        )
      }
      fileSize = meta.size
    }
```

Then change the `mediaRepo.create(...)` call to record the real size: replace `file_size: 0` with `file_size: fileSize`.

> `IMAGE_MIME_TYPES`/`VIDEO_MIME_TYPES`/`FILE_MIME_TYPES` are already module constants in `media.ts` (`:10-19`). `maxFileSize` is already a parameter of `registerAdminMediaRoutes`. `FILE_TOO_LARGE`, `UNSUPPORTED_MIME_TYPE`, `STORAGE_ERROR` are existing `ErrorCode`s (`packages/core/src/errors.ts`).

- [ ] **Step 7: Run the confirm test + full media suite + typecheck**

Run: `pnpm --filter @bobbykim/manguito-cms-api test media && pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit && pnpm --filter @bobbykim/manguito-cms-core exec tsc --noEmit`
Expected: PASS — oversized/mismatched confirms rejected and object deleted; valid confirms record real `file_size`; no type errors.

- [ ] **Step 8: Amend ADR api/0004**

In `docs/adr/api/0004-presigned-first-storage.md`, under Consequences, append:

```markdown
- **Amendment (2026-07, security round):** `StorageAdapter` gained an optional
  `stat(key)`; the media `confirm` step now uses it (where available) to reject
  objects exceeding `max_file_size` (`413`) or whose stored content-type is
  outside the accepted set (`415`), deleting the offending object, and to record
  the true `file_size` (previously hardcoded `0`). Adapters without `stat`
  (Cloudinary) skip enforcement — tracked as a follow-up. Refs audit Finding #8.
```

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/config/types.ts packages/api/src/storage/adapters/local.ts packages/api/src/storage/adapters/s3.ts packages/api/src/storage/adapters/__tests__/ packages/api/src/routes/admin/media.ts packages/api/src/__tests__/ docs/adr/api/0004-presigned-first-storage.md
git commit -m "feat(api,core): validate presigned upload size/type on confirm (Finding #8)

Adds optional StorageAdapter.stat; confirm rejects oversized/mismatched
objects and records real file_size. Amends ADR api/0004."
```

---

### Final verification (after all tasks)

- [ ] **Full test suite**

Run: `pnpm test`
Expected: all packages pass (integration tests need `DB_URL` in `.env.test`).

- [ ] **Full build in dependency order**

Run: `pnpm build`
Expected: `core → db → api → admin → cli` build with no type errors (confirms the new core interface field and the `/runtime` helpers resolve across packages, and the codegen imports are valid).

---

## Self-Review

**Spec coverage** (audit app-code findings → tasks): #1 → Task 1+2; #2 → Task 1+2; #3 → Task 3; #4 → Task 7; #5 → Task 4; #6 → Task 5; #8 → Task 9; #9 → Task 8; #11 → Task 6. Infra #7/#12 and deps #10 are explicitly **out of scope** (separate follow-up plan, per the scoping decision). ✅

**ADR alignment:**
- #2/#1 fix serves untrusted media safely rather than sanitizing, and moves logic to a tested helper — consistent with [ADR api/0008]; ADR amended (Task 2).
- #5 preserves the no-lockout/IP+email decision and adds a global ceiling matching the `findAll` two-scope model — [ADR api/0005] amended (Task 4).
- #11 mirrors the update-path `content:edit` publish gate — [ADR api/0002]. ✅
- #6 removes dead shims, keeping the documented middleware chain — [ADR api/0003]. ✅
- #8 implements the size-bounding both storage ADRs deferred to "the pre-release security round" — [ADR api/0004] amended. ✅
- All error paths use the `{ ok:false, error:{ code, message } }` envelope ([ADR 0002]) and return typed responses rather than throwing ([ADR 0001]). ✅

**Type consistency:** `resolveStaticFile(baseDir, urlSubPath): string | null`, `StorageAdapter.stat?(key): Promise<{ size, content_type? } | null>`, `CreateCmsAppOptions.cors?: CorsConfig`, `createSecurityHeadersMiddleware(): MiddlewareHandler` — each defined once and consumed with the same signature downstream. ✅

**Assumptions to confirm during execution** (flagged rather than guessed):
- Task 3/4/6: the exact test harness style in `auth.test.ts` and the admin content integration suite (mock vs real DB, and which `TestRole` has `content:create` without `content:edit`) — confirm against the fixtures before writing the test body.
- Task 5: the precise line numbers of route-level `requireAuth` arguments shift as the file changes; remove by matching the `requireAuth,` token, not the line number.
- Task 9: whether the media confirm suite is unit or integration, and the presign→upload→confirm helper it exposes.

## Execution Handoff

Recommend **subagent-driven** execution (same as the rate-limit work): fresh implementer per task, task review after each, broad review at the end. Tasks 1→2 are sequential (2 depends on 1's helper + built dist); 3, 4, 6, 8 are independent; 5 precedes 6 (6 relies on `requirePermission` being in scope in the create handler, which 5 leaves intact); 7 and 9 are independent but larger.
