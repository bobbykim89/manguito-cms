# CSP / Admin Deployment Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Task-8 Content-Security-Policy compatible with the real admin SPA and the presigned-upload architecture, so the Lambda+S3 (and Cloudinary) deployment loads and uploads without CSP violations — without weakening the policy (no `'unsafe-inline'` for scripts).

**Architecture:** The CSP is currently a hardcoded string that (1) blocks the admin's inline Vite polyfill script, (2) blocks its external Google Fonts, and (3) has no `connect-src`, so it inherits `default-src 'self'` and blocks the browser's direct presigned upload to the storage origin. The storage origin is per-deployment config known only to the storage adapter. Fix: expose the storage's upload origin from the adapter, build `connect-src` from it (config-driven CSP, parallel to how CORS became config-driven), self-host the admin fonts so no external origin is needed, and drop the inline polyfill so `script-src 'self'` suffices.

**Tech Stack:** TypeScript (strict), Hono middleware, `@aws-sdk` (S3), Vite 8 + Vue 3 (admin), `@fontsource/*`, Vitest. Packages touched: `core` (StorageAdapter interface), `api` (adapters, security-headers middleware, app wiring), `admin` (build config + fonts).

**Source-of-truth references:**
- Diagnosis: this conversation's CSP analysis (Task 8 middleware `packages/api/src/middleware/security-headers.ts`).
- Storage origins verified from adapters: S3 `packages/api/src/storage/adapters/s3.ts:64,70` → `https://<bucket>.s3.<region>.amazonaws.com`; Cloudinary `packages/api/src/storage/adapters/cloudinary.ts:67` → `https://api.cloudinary.com`.
- ADRs: [api/0004 presigned-first storage](../../adr/api/0004-presigned-first-storage.md) (why uploads go browser→storage directly), [api/0008 media upload security](../../adr/api/0008-media-upload-security.md) (serving-security posture).

## Global Constraints

- TypeScript strict mode only; no JavaScript files. (CLAUDE.md)
- Layer boundaries: `core` imports nothing from db/api/admin/cli; `api` imports only core+db; `admin` imports from core. `core` gains only a type addition. (CLAUDE.md)
- **Do NOT relax `script-src` to `'unsafe-inline'`** — that defeats the XSS protection the middleware exists for. Fix the inline script at the build instead.
- `exactOptionalPropertyTypes` is on — optional properties via conditional spread, never `= undefined`.
- Factory functions over classes; named function declarations for top-level exports; arrow functions for callbacks. (CLAUDE.md)
- Presigned uploads go directly browser→storage ([ADR api/0004]); the CSP must permit that connection for the configured adapter, and nothing more (least privilege — exact bucket host, not a wildcard).
- Self-hosted fonts must keep the exact family names the admin CSS references: `"Plus Jakarta Sans"` and `"JetBrains Mono"` (`packages/admin/src/style.css:4-5`).

## Decisions (settled with the user)

- **Fonts:** self-host via `@fontsource/plus-jakarta-sans` + `@fontsource/jetbrains-mono` (npm packages ARE the font files — no manual files, no external origin). Remove the Google Fonts `<link>`.
- **Inline script:** disable the Vite module-preload polyfill (`build.modulePreload.polyfill = false`) so `script-src 'self'` works; no nonce/hash.
- **`/admin/api/config` 401:** out of scope — pre-existing/expected (the route requires auth; logged-out probe → 401 → SPA redirects to login). Not caused by the security work.

## File Structure

- `packages/core/src/config/types.ts` — **modify.** Add optional `getUploadOrigins?(): string[]` to `StorageAdapter`.
- `packages/api/src/storage/adapters/s3.ts` — **modify.** Implement `getUploadOrigins`.
- `packages/api/src/storage/adapters/cloudinary.ts` — **modify.** Implement `getUploadOrigins`.
- `packages/api/src/storage/adapters/__tests__/upload-origins.test.ts` — **create.** Unit tests for the two adapters.
- `packages/api/src/middleware/security-headers.ts` — **modify.** Config-driven CSP (`connect-src` from options; add `font-src 'self'`).
- `packages/api/src/middleware/__tests__/security-headers.test.ts` — **modify.** Assert connect-src/font-src behavior.
- `packages/api/src/app.ts` — **modify.** Thread `storage.getUploadOrigins()` into the middleware.
- `packages/admin/package.json` — **modify.** Add the two `@fontsource` deps.
- `packages/admin/src/main.ts` — **modify.** Import the self-hosted font CSS.
- `packages/admin/index.html` — **modify.** Remove the Google Fonts preconnect + `<link>`.
- `packages/admin/vite.config.ts` — **modify.** Disable the module-preload polyfill.
- `docs/adr/api/0010-config-driven-csp.md` — **create.** Record the CSP-from-storage decision.

---

### Task 1: Expose the storage upload origin from the adapters

**Files:**
- Modify: `packages/core/src/config/types.ts` (StorageAdapter interface, near `stat?` added earlier)
- Modify: `packages/api/src/storage/adapters/s3.ts`
- Modify: `packages/api/src/storage/adapters/cloudinary.ts`
- Test: `packages/api/src/storage/adapters/__tests__/upload-origins.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `StorageAdapter.getUploadOrigins?(): string[]` — the cross-origin hosts the browser connects to during a presigned upload, as CSP `connect-src` origin strings (scheme+host, no path). S3 → `["https://<bucket>.s3.<region>.amazonaws.com"]`; Cloudinary → `["https://api.cloudinary.com"]`; local omits it (same-origin).

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/storage/adapters/__tests__/upload-origins.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createS3Adapter } from '../s3'
import { createCloudinaryAdapter } from '../cloudinary'

describe('getUploadOrigins', () => {
  it('S3 returns the virtual-hosted bucket origin', () => {
    const adapter = createS3Adapter({ bucket: 'my-bucket', region: 'us-west-2' })
    expect(adapter.getUploadOrigins?.()).toEqual([
      'https://my-bucket.s3.us-west-2.amazonaws.com',
    ])
  })

  it('Cloudinary returns the api.cloudinary.com upload origin', () => {
    const adapter = createCloudinaryAdapter({ cloud_name: 'demo' })
    expect(adapter.getUploadOrigins?.()).toEqual(['https://api.cloudinary.com'])
  })
})
```

> Confirm the exact factory signatures/required options before running (`createS3Adapter`/`createCloudinaryAdapter` option shapes — read the top of each adapter). Adjust the option objects to the minimum required to construct each adapter.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test upload-origins`
Expected: FAIL — `getUploadOrigins` is not a function.

- [ ] **Step 3: Add the interface method (core)**

In `packages/core/src/config/types.ts`, in the `StorageAdapter` interface, after the `stat?` method added previously, add:

```typescript
  /**
   * Cross-origin hosts the browser connects to during a presigned upload,
   * as CSP connect-src origins (scheme + host, no path). Used to build the
   * Content-Security-Policy. Adapters whose uploads are same-origin (local)
   * omit this.
   */
  getUploadOrigins?(): string[]
```

- [ ] **Step 4: Implement in the S3 adapter**

In `packages/api/src/storage/adapters/s3.ts`, add to the returned adapter object (the `bucket` and `region` are already in closure scope):

```typescript
    getUploadOrigins(): string[] {
      return [`https://${bucket}.s3.${region}.amazonaws.com`]
    },
```

- [ ] **Step 5: Implement in the Cloudinary adapter**

In `packages/api/src/storage/adapters/cloudinary.ts`, add to the returned adapter object:

```typescript
    getUploadOrigins(): string[] {
      // Uploads POST to api.cloudinary.com (cloud_name is in the path, not the host).
      return ['https://api.cloudinary.com']
    },
```

- [ ] **Step 6: Run the test + typecheck**

Run: `pnpm --filter @bobbykim/manguito-cms-core build && pnpm --filter @bobbykim/manguito-cms-api test upload-origins && pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit`
Expected: PASS (2 tests); no type errors. (Core builds first so `api` resolves the new optional method.)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/config/types.ts packages/api/src/storage/adapters/s3.ts packages/api/src/storage/adapters/cloudinary.ts packages/api/src/storage/adapters/__tests__/upload-origins.test.ts
git commit -m "feat(api,core): expose storage upload origins for CSP connect-src"
```

---

### Task 2: Make the security-headers CSP config-driven (connect-src + font-src)

**Files:**
- Modify: `packages/api/src/middleware/security-headers.ts`
- Modify: `packages/api/src/app.ts`
- Test: `packages/api/src/middleware/__tests__/security-headers.test.ts` (extend)
- Create: `docs/adr/api/0010-config-driven-csp.md`

**Interfaces:**
- Consumes: `storage.getUploadOrigins()` (Task 1).
- Produces: `createSecurityHeadersMiddleware(options?: { connectSrc?: string[] }): MiddlewareHandler` — CSP `connect-src` is `'self'` plus the provided origins; adds `font-src 'self'`.

- [ ] **Step 1: Write the failing test**

In `packages/api/src/middleware/__tests__/security-headers.test.ts`, add:

```typescript
it("connect-src defaults to 'self' when no origins are provided", async () => {
  const app = new Hono()
  app.use('*', createSecurityHeadersMiddleware())
  app.get('/x', (c) => c.json({ ok: true }))
  const res = await app.request('/x')
  const csp = res.headers.get('Content-Security-Policy') ?? ''
  expect(csp).toContain("connect-src 'self'")
  expect(csp).toContain("font-src 'self'")
})

it('includes provided upload origins in connect-src', async () => {
  const app = new Hono()
  app.use('*', createSecurityHeadersMiddleware({
    connectSrc: ['https://my-bucket.s3.us-west-2.amazonaws.com'],
  }))
  app.get('/x', (c) => c.json({ ok: true }))
  const res = await app.request('/x')
  const csp = res.headers.get('Content-Security-Policy') ?? ''
  expect(csp).toContain("connect-src 'self' https://my-bucket.s3.us-west-2.amazonaws.com")
})
```

(Keep the existing test that asserts nosniff/X-Frame-Options/Referrer-Policy/`frame-ancestors 'none'`; it should still pass.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test security-headers`
Expected: FAIL — no `connect-src`/`font-src` directives; factory takes no options.

- [ ] **Step 3: Rewrite the middleware to build the CSP from options**

Replace `packages/api/src/middleware/security-headers.ts` with:

```typescript
import type { MiddlewareHandler } from 'hono'

export type SecurityHeadersOptions = {
  /** Extra origins allowed for connect-src (e.g. the storage upload host). */
  connectSrc?: string[]
}

/**
 * Conservative security headers. CSP allows same-origin scripts/styles/fonts
 * for the admin SPA (served same-origin) and blocks framing. connect-src is
 * 'self' plus any storage upload origins passed in — presigned uploads go
 * browser→storage directly (ADR api/0004), so that host must be allowlisted.
 */
export function createSecurityHeadersMiddleware(
  options: SecurityHeadersOptions = {},
): MiddlewareHandler {
  const connectSrc = ["'self'", ...(options.connectSrc ?? [])].join(' ')
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: https:",
    "media-src 'self' https:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')

  return async function securityHeaders(c, next) {
    await next()
    c.res.headers.set('X-Content-Type-Options', 'nosniff')
    c.res.headers.set('X-Frame-Options', 'DENY')
    c.res.headers.set('Referrer-Policy', 'no-referrer')
    c.res.headers.set('Content-Security-Policy', csp)
  }
}
```

- [ ] **Step 4: Thread the storage origins in `app.ts`**

In `packages/api/src/app.ts`, replace the security-headers registration:

```typescript
  const uploadOrigins = storage.getUploadOrigins?.() ?? []
  app.use('*', createSecurityHeadersMiddleware({ connectSrc: uploadOrigins }))
```

(`storage` is already destructured from options; keep the existing explanatory comment above it, adjusting wording to mention connect-src is derived from the storage adapter.)

- [ ] **Step 5: Run the test + typecheck + full api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test security-headers && pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit && pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS (existing + 2 new security-headers tests; full suite green).

- [ ] **Step 6: Record the decision as an ADR**

Create `docs/adr/api/0010-config-driven-csp.md`:

```markdown
---
status: accepted
---

# The Content-Security-Policy is built from the storage adapter's upload origin

The security-headers middleware sets a strict CSP (`default-src 'self'`,
`script-src 'self'`, no `'unsafe-inline'` for scripts). Presigned uploads,
however, go directly from the browser to the storage backend
([ADR api/0004](./0004-presigned-first-storage.md)), whose origin is
per-deployment configuration — S3 `https://<bucket>.s3.<region>.amazonaws.com`,
Cloudinary `https://api.cloudinary.com`. A hardcoded CSP therefore blocked the
upload `connect-src`. The storage adapter exposes `getUploadOrigins()`, and
`createCmsApp` threads it into `createSecurityHeadersMiddleware({ connectSrc })`,
so `connect-src` is exactly `'self'` plus the configured storage host — no
wildcard. The admin SPA self-hosts its fonts (bundled, same-origin) so no
external font origin is allowlisted, and the Vite module-preload polyfill is
disabled so `script-src 'self'` needs no inline exception.

## Considered Options

- **Relax `script-src` to `'unsafe-inline'` / add a broad `connect-src *`** —
  rejected: guts the XSS/exfiltration protection the middleware exists for.
- **Nonce the inline script** — rejected for now: the admin HTML is served as a
  static file, so per-response nonce injection means rewriting the HTML on every
  request; disabling the polyfill is simpler and safe for modern targets.
- **Allowlist the external Google Fonts origins** — rejected in favor of
  self-hosting, which removes the third-party origin entirely.

## Consequences

- Adding a storage adapter means implementing `getUploadOrigins()` (optional; a
  same-origin/local adapter omits it). Cloudinary serves from
  `res.cloudinary.com`, already permitted by `img-src https:`.
- A custom S3 endpoint (path-style, transfer acceleration, or a non-AWS S3) is
  not covered by the default virtual-hosted origin and would need the adapter to
  return the matching host — tracked as a follow-up if such config is added.
```

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/middleware/security-headers.ts packages/api/src/middleware/__tests__/security-headers.test.ts packages/api/src/app.ts docs/adr/api/0010-config-driven-csp.md
git commit -m "fix(api): build CSP connect-src from storage upload origins

Presigned uploads connect browser->storage directly; the CSP now allowlists
exactly the configured storage host. Adds font-src 'self'. Refs ADR api/0004,
new ADR api/0010."
```

---

### Task 3: Self-host admin fonts and drop the inline Vite polyfill

**Files:**
- Modify: `packages/admin/package.json`
- Modify: `packages/admin/src/main.ts`
- Modify: `packages/admin/index.html`
- Modify: `packages/admin/vite.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: an admin build whose `index.html` has no inline `<script>` and no external font `<link>`; fonts are bundled same-origin.

**Context:** `packages/admin/src/style.css:4-5` references `"Plus Jakarta Sans"` and `"JetBrains Mono"`. The Google Fonts `<link>` loads Jakarta weights 400/500/600/700/800 and JetBrains Mono 400/500 (`packages/admin/index.html:8-11`). `@fontsource` provides those exact families/weights as bundled CSS + woff2. This task is verified by building the admin and inspecting the output HTML (no runtime unit test).

- [ ] **Step 1: Add the font packages**

In `packages/admin/package.json`, add to `dependencies`:

```json
    "@fontsource/plus-jakarta-sans": "^5.0.0",
    "@fontsource/jetbrains-mono": "^5.0.0",
```

Then install: `pnpm install`
Expected: both packages resolve and appear in the lockfile. (If `^5.0.0` doesn't resolve, use the latest `5.x` the registry offers — check with `pnpm view @fontsource/plus-jakarta-sans version`.)

- [ ] **Step 2: Import the fonts in the admin entry**

In `packages/admin/src/main.ts`, add these imports **above** `import './style.css'` (weights matching the current Google Fonts request):

```typescript
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
```

- [ ] **Step 3: Remove the Google Fonts link from index.html**

In `packages/admin/index.html`, delete these three elements (the preconnects and the stylesheet link, `:6-11`):

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
```

Leave the `<link rel="icon" ...>` and `<title>` intact.

- [ ] **Step 4: Disable the module-preload polyfill in Vite**

In `packages/admin/vite.config.ts`, add a `build` option to the config object:

```typescript
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: {
    __ADMIN_PREFIX__: JSON.stringify('/admin'),
    __API_PREFIX__: JSON.stringify('/api'),
  },
  build: {
    // No inline module-preload polyfill — keeps script-src 'self' working
    // without an inline-script exception. Modern browsers preload modules
    // natively via <link rel="modulepreload">.
    modulePreload: { polyfill: false },
  },
})
```

- [ ] **Step 5: Build the admin and verify the output HTML**

Run: `pnpm --filter @bobbykim/manguito-cms-admin build`
Then inspect the built HTML (Vite default outDir is `dist`):

Run: `grep -c "fonts.googleapis.com" packages/admin/dist/index.html; grep -o "<script[^>]*>" packages/admin/dist/index.html`
Expected:
- `fonts.googleapis.com` count is `0` (no external font link).
- The only `<script>` tags are `<script type="module" ... src="...">` (external) — **no bare `<script>` without a `src`** (no inline polyfill). If a bare inline `<script>` remains, the polyfill disable didn't take — recheck the Vite `build.modulePreload` option and Vite version behavior.

- [ ] **Step 6: Sanity-check fonts resolve**

Run: `ls packages/admin/dist/assets | grep -iE "jakarta|jetbrains" | head`
Expected: bundled woff2 (or the fontsource CSS references) are present in the build output — confirming the fonts are self-hosted, not external. (Exact filenames are hashed; presence is what matters.)

- [ ] **Step 7: Commit**

```bash
git add packages/admin/package.json packages/admin/src/main.ts packages/admin/index.html packages/admin/vite.config.ts pnpm-lock.yaml
git commit -m "fix(admin): self-host fonts and drop inline module-preload polyfill

Removes the external Google Fonts link and the inline Vite polyfill script so
the strict CSP (script-src 'self', no external font origin) is satisfied."
```

---

### Final verification (after all tasks — run before redeploying)

- [ ] **Full build in dependency order**

Run: `pnpm build`
Expected: `core → db → api → admin → cli` build clean (confirms the new interface method and admin build changes integrate across packages).

- [ ] **Confirm the generated CSP header locally (S3 config)**

With an S3-configured `manguito.config.ts`, start the built server (or exercise `createCmsApp` in a scratch test) and inspect the response header on any route:

Run (example): `curl -sI http://localhost:3000/admin/ | grep -i content-security-policy`
Expected: `connect-src 'self' https://<your-bucket>.s3.<region>.amazonaws.com`, `script-src 'self'` (no `unsafe-inline`), `font-src 'self'`, and no `fonts.googleapis.com` anywhere.

- [ ] **Redeploy checklist (Lambda + S3)** — manual, done by the operator:
  1. `manguito build` and redeploy the Lambda with the new admin bundle + API.
  2. Load `/admin` → no CSP violations in the console; the SPA renders and fonts apply.
  3. Log in → the `/admin/api/config` 401 pre-login is expected; after login it returns 200.
  4. Upload an image → the presigned PUT to `https://<bucket>.s3.<region>.amazonaws.com` succeeds (no `connect-src` violation), and confirm records the real file size.

---

## Self-Review

**Root-cause coverage:** inline script → Task 3 (disable polyfill); Google Fonts → Task 3 (self-host); `connect-src`/S3 upload → Tasks 1+2 (adapter origin → config-driven CSP); `/admin/api/config` 401 → explicitly out of scope (pre-existing). ✅

**No weakening:** `script-src` stays `'self'` (no `'unsafe-inline'`); `connect-src` is `'self'` + the exact configured storage host (no wildcard); fonts are same-origin. The policy is *tighter* than before in that it no longer depends on an external font CDN. ✅

**Type/interface consistency:** `getUploadOrigins?(): string[]` defined in core (Task 1), implemented in s3/cloudinary (Task 1), consumed in app.ts (Task 2); `createSecurityHeadersMiddleware({ connectSrc })` signature defined and consumed in the same task. ✅

**Assumptions to confirm during execution:**
- The `createS3Adapter`/`createCloudinaryAdapter` option shapes (Task 1 test) — read the adapter factory signatures before finalizing the test's option objects.
- The admin build outDir is Vite default `dist` (Task 3 verification greps `packages/admin/dist/index.html`) — confirm against `packages/admin/vite.config.ts`/`package.json` build script; adjust the path if the build emits elsewhere.
- `@fontsource` `5.x` availability for both families (Task 3 Step 1).
- Whether disabling `modulePreload.polyfill` fully removes the inline `<script>` on this Vite 8 build (Task 3 Step 5 verifies empirically; if an inline script persists, fall back to computing its sha256 and adding it to `script-src`, and note it).

## Execution Handoff

Recommend **subagent-driven** execution. Task order: 1 → 2 (2 consumes 1), then 3 (independent of 1/2, admin-only). The final verification + redeploy is operator-run.
