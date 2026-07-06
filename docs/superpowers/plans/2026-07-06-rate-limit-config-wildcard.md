# Rate-Limit Config + Wildcard Disable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure public list-endpoint rate limiting from `manguito.config.ts`, and disable it entirely by setting `rateLimit: { findAll: '*' }`.

**Architecture:** The rate-limit *middleware* already works and is configurable, but no config path reaches it — the core `APIAdapter` type and the `createAPIAdapter` factory don't expose `rateLimit`, and neither build (`server-entries.ts`) nor dev (`dev.ts`) call sites forward it to `createCmsApp`. This plan wires `rateLimit` end-to-end (core type → factory → both call sites → middleware) and adds a `'*'` sentinel on `findAll` that resolves to "no limiter middleware registered" (zero overhead — the route registrators already skip registration when the middleware is `undefined`).

**Tech Stack:** TypeScript (strict), Hono middleware, Vitest, pnpm workspace + Turborepo. Packages touched: `core` (config types), `api` (factory, middleware, app wiring), `cli` (dev + build codegen).

## Global Constraints

- TypeScript strict mode only — no JavaScript files. Copied verbatim from CLAUDE.md.
- Layer boundaries: `core` imports nothing from db/api/admin/cli; `api` imports only from `core` and `db`; `cli` imports from all. (This plan has `api` and `cli` import a new type from `core` — allowed. `core` gains no new imports.)
- Factory functions over classes; named function declarations for top-level exports; arrow functions for callbacks.
- Internal failures use the Result type — never throw for expected conditions. (The wildcard is enforced by the TypeScript literal type `'*'`; no runtime validation/throw is added.)
- HTTP responses use the `{ ok, data }` / `{ ok, error: { code, message } }` envelope. (Unchanged here — the disable path registers no 429-producing middleware.)
- Do NOT add dependencies to `manguito-cms-core`. (This plan adds only a type — no dependency.)
- The project uses `exactOptionalPropertyTypes` (evidenced by the `...(media !== undefined && { media })` spread pattern in `createAPIAdapter`). Optional properties must be added via conditional spread, never assigned `undefined`.

---

## File Structure

- `packages/core/src/config/types.ts` — **modify.** Add `ResolvedRateLimitConfig` type; add `readonly rateLimit?` to the `APIAdapter` interface. This is the single source of truth for the config shape, consumed by both `api` and `cli`.
- `packages/api/src/index.ts` — **modify.** `createAPIAdapter` (the user-facing factory) accepts and forwards `rateLimit`.
- `packages/api/src/__tests__/create-api-adapter.test.ts` — **create.** Unit tests for the factory passthrough.
- `packages/api/src/middleware/rate-limit.ts` — **modify.** Add `resolveListRateLimit(rateLimit?)` — the one place that owns the defaults and the `'*'`-disable decision. Returns `MiddlewareHandler | undefined`.
- `packages/api/src/middleware/__tests__/rate-limit.test.ts` — **modify.** Add unit tests for `resolveListRateLimit`.
- `packages/api/src/app.ts` — **modify.** Type `rateLimit` as `ResolvedRateLimitConfig`; replace the inline middleware construction with `resolveListRateLimit(rateLimit)`.
- `packages/api/src/__tests__/rate-limit.integration.test.ts` — **modify.** Add a DB-backed test proving `findAll: '*'` disables the limiter.
- `packages/cli/src/commands/dev.ts` — **modify.** Forward `config.api.rateLimit` at both `createCmsApp` call sites.
- `packages/cli/src/codegen/server-entries.ts` — **modify.** Forward `config.api.rateLimit` in the generated `createCmsApp` call; export `appSetup` for testing.
- `packages/cli/tests/dev.test.ts` — **modify.** Assert `createCmsApp` receives `rateLimit` when the config carries it.
- `packages/cli/tests/server-entries.test.ts` — **create.** Assert the generated code threads `config.api.rateLimit`.
- `apps/sandbox/manguito.config.ts` — **modify.** Add a commented `rateLimit` example (discoverability/docs).

---

### Task 1: Wire `rateLimit` through the core config type and the `createAPIAdapter` factory

**Files:**
- Modify: `packages/core/src/config/types.ts:105-114`
- Modify: `packages/api/src/index.ts:1-25`
- Test: `packages/api/src/__tests__/create-api-adapter.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `ResolvedRateLimitConfig = { findAll?: '*' | { windowMs?: number; maxPerIp?: number; maxGlobal?: number } }` (exported from `@bobbykim/manguito-cms-core`)
  - `APIAdapter.rateLimit?: ResolvedRateLimitConfig` (readonly)
  - `createAPIAdapter(options?: { prefix?: string; media?: { max_file_size?: number }; rateLimit?: ResolvedRateLimitConfig }): APIAdapter`

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/__tests__/create-api-adapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createAPIAdapter } from '../index'

describe('createAPIAdapter', () => {
  it('omits rateLimit when not provided', () => {
    const adapter = createAPIAdapter({ prefix: '/api' })
    expect(adapter.rateLimit).toBeUndefined()
  })

  it('passes through a numeric findAll rateLimit config', () => {
    const adapter = createAPIAdapter({
      rateLimit: { findAll: { maxPerIp: 10, maxGlobal: 100, windowMs: 30_000 } },
    })
    expect(adapter.rateLimit).toEqual({
      findAll: { maxPerIp: 10, maxGlobal: 100, windowMs: 30_000 },
    })
  })

  it("passes through the '*' wildcard that disables the list limiter", () => {
    const adapter = createAPIAdapter({ rateLimit: { findAll: '*' } })
    expect(adapter.rateLimit).toEqual({ findAll: '*' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test create-api-adapter`
Expected: FAIL — TypeScript error that `rateLimit` does not exist on the `createAPIAdapter` options / on `APIAdapter`, or the `rateLimit` assertions receive `undefined`.

- [ ] **Step 3: Add the config type to core**

In `packages/core/src/config/types.ts`, in the `─── API Adapter ───` section (immediately after the `ResolvedMediaConfig` type, before `export interface APIAdapter`), add:

```typescript
export type ResolvedRateLimitConfig = {
  /**
   * Rate limiting for public list endpoints (paginated collections, not
   * single-item lookups). Set `findAll: '*'` to disable the list-endpoint
   * limiter entirely.
   */
  findAll?:
    | '*'
    | {
        windowMs?: number
        maxPerIp?: number
        maxGlobal?: number
      }
}
```

Then extend the `APIAdapter` interface (currently `prefix` + `media`) to:

```typescript
export interface APIAdapter {
  readonly prefix: string
  readonly media?: ResolvedMediaConfig
  readonly rateLimit?: ResolvedRateLimitConfig
}
```

- [ ] **Step 4: Export the new type from core's public surface**

In `packages/core/src/index.ts`, find the block that re-exports config types (it already exports `APIAdapter` — see the list around line 19) and add `ResolvedRateLimitConfig` to it, keeping alphabetical/existing ordering consistent with neighbors. Example (match the surrounding `export type { ... }` form):

```typescript
export type {
  // ...existing entries...
  APIAdapter,
  ResolvedRateLimitConfig,
  // ...existing entries...
} from './config/types.js'
```

Verify the export path/style matches how `APIAdapter` is currently exported in that file — mirror it exactly (same `from` specifier, same `type`-only vs value form).

- [ ] **Step 5: Forward `rateLimit` in `createAPIAdapter`**

Replace the contents of `packages/api/src/index.ts` with:

```typescript
import type { APIAdapter, ResolvedRateLimitConfig } from '@bobbykim/manguito-cms-core'

export { createCmsApp } from './app.js'
export type { CreateCmsAppOptions } from './app.js'

export { createServer } from './server/node.js'
export type { NodeServerOptions } from './server/node.js'

// ─── User-facing config factory ───────────────────────────────────────────────

export type APIAdapterOptions = {
  prefix?: string
  media?: {
    max_file_size?: number
  }
  rateLimit?: ResolvedRateLimitConfig
}

export function createAPIAdapter(options: APIAdapterOptions = {}): APIAdapter {
  const prefix = options.prefix ?? '/api'
  const media = options.media?.max_file_size !== undefined
    ? { max_file_size: options.media.max_file_size }
    : undefined

  return {
    prefix,
    ...(media !== undefined && { media }),
    ...(options.rateLimit !== undefined && { rateLimit: options.rateLimit }),
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test create-api-adapter`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck core + api**

Run: `pnpm --filter @bobbykim/manguito-cms-core build && pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit`
Expected: no type errors. (Core must build first so `api` resolves the new exported type from `dist`.)

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/config/types.ts packages/core/src/index.ts packages/api/src/index.ts packages/api/src/__tests__/create-api-adapter.test.ts
git commit -m "feat(api,core): expose rateLimit on createAPIAdapter and APIAdapter config"
```

---

### Task 2: Add `resolveListRateLimit` with `'*'`-disable, and use it in `createCmsApp`

**Files:**
- Modify: `packages/api/src/middleware/rate-limit.ts:1-11`
- Modify: `packages/api/src/app.ts` (imports; `CreateCmsAppOptions.rateLimit` type at lines 36-43; middleware construction at lines 83-87)
- Test: `packages/api/src/middleware/__tests__/rate-limit.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `ResolvedRateLimitConfig` from `@bobbykim/manguito-cms-core` (Task 1).
- Produces: `resolveListRateLimit(rateLimit?: ResolvedRateLimitConfig): import('hono').MiddlewareHandler | undefined` — returns `undefined` when `findAll === '*'` (limiter disabled), otherwise a configured middleware using the defaults `windowMs 60_000`, `maxPerIp 30`, `maxGlobal 500`.

- [ ] **Step 1: Write the failing test**

In `packages/api/src/middleware/__tests__/rate-limit.test.ts`, update the import at the top:

```typescript
import { createRateLimitMiddleware, resolveListRateLimit } from '../rate-limit'
```

Then append this describe block at the end of the file (after the existing `describe('rate-limit middleware', ...)` block):

```typescript
describe('resolveListRateLimit', () => {
  it("returns undefined (limiter disabled) when findAll is '*'", () => {
    expect(resolveListRateLimit({ findAll: '*' })).toBeUndefined()
  })

  it('returns a middleware when rateLimit is undefined (uses defaults)', () => {
    expect(typeof resolveListRateLimit(undefined)).toBe('function')
  })

  it('returns a middleware when findAll is a numeric config', () => {
    expect(typeof resolveListRateLimit({ findAll: { maxPerIp: 5 } })).toBe('function')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test rate-limit.test`
Expected: FAIL — `resolveListRateLimit` is not exported from `../rate-limit`.

- [ ] **Step 3: Implement `resolveListRateLimit` in the middleware module**

In `packages/api/src/middleware/rate-limit.ts`, update the top of the file (imports + a defaults block) and append the new function. The final file's header and tail become:

Header (replace lines 1-7):

```typescript
import type { MiddlewareHandler } from 'hono'
import type { ResolvedRateLimitConfig } from '@bobbykim/manguito-cms-core'

// Defaults for the public list-endpoint limiter. Single source of truth —
// createCmsApp resolves its limiter through resolveListRateLimit below.
const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX_PER_IP = 30
const DEFAULT_MAX_GLOBAL = 500

export type RateLimitOptions = {
  windowMs: number
  maxPerIp: number
  maxGlobal: number
}
```

Append at the end of the file (after `createRateLimitMiddleware`):

```typescript
/**
 * Resolves the public list-endpoint config into a middleware, or `undefined`
 * when the limiter is disabled via the `findAll: '*'` wildcard. Route
 * registrators skip registration when this is `undefined`, so a disabled
 * limiter has zero request-path overhead.
 */
export function resolveListRateLimit(
  rateLimit?: ResolvedRateLimitConfig,
): MiddlewareHandler | undefined {
  const findAll = rateLimit?.findAll
  if (findAll === '*') {
    return undefined
  }
  return createRateLimitMiddleware({
    windowMs: findAll?.windowMs ?? DEFAULT_WINDOW_MS,
    maxPerIp: findAll?.maxPerIp ?? DEFAULT_MAX_PER_IP,
    maxGlobal: findAll?.maxGlobal ?? DEFAULT_MAX_GLOBAL,
  })
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test rate-limit.test`
Expected: PASS — the original 4 middleware tests plus 3 new `resolveListRateLimit` tests.

- [ ] **Step 5: Use `resolveListRateLimit` in `createCmsApp`**

In `packages/api/src/app.ts`:

(a) Change the middleware import (currently `import { createRateLimitMiddleware } from './middleware/rate-limit.js'`) to:

```typescript
import { resolveListRateLimit } from './middleware/rate-limit.js'
```

(b) Add `ResolvedRateLimitConfig` to the existing `import type { ... } from '@bobbykim/manguito-cms-core'` line (the one that already imports `SchemaRegistry`).

(c) Replace the inline `rateLimit` option type on `CreateCmsAppOptions` (lines 36-43) with:

```typescript
  rateLimit?: ResolvedRateLimitConfig
```

(d) Replace the middleware construction (lines 83-87) with:

```typescript
  // Rate limiter for public list endpoints — threaded into route registrators,
  // applied only to paginated collection routes (not single-item lookups).
  // `undefined` when disabled via rateLimit.findAll === '*'.
  const listRateLimit = resolveListRateLimit(rateLimit)
```

The route registrators (`registerPublicContentRoutes`, `registerPublicMediaRoutes` at `app.ts:203-204`) already accept `listRateLimit?: MiddlewareHandler` and skip the middleware when it is `undefined`, so no changes are needed there.

- [ ] **Step 6: Run the api package tests + typecheck**

Run: `pnpm --filter @bobbykim/manguito-cms-api test rate-limit.test && pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/middleware/rate-limit.ts packages/api/src/middleware/__tests__/rate-limit.test.ts packages/api/src/app.ts
git commit -m "feat(api): resolve list rate limiter via resolveListRateLimit, support '*' disable"
```

---

### Task 3: Forward `config.api.rateLimit` through the dev and build call sites

**Files:**
- Modify: `packages/cli/src/commands/dev.ts:157-164` and `:304-311` (both `createCmsApp` calls)
- Modify: `packages/cli/src/codegen/server-entries.ts` (`appSetup()` string; export `appSetup`)
- Test: `packages/cli/tests/dev.test.ts` (add a test)
- Test: `packages/cli/tests/server-entries.test.ts` (create)

**Interfaces:**
- Consumes: `config.api.rateLimit` (`ResolvedRateLimitConfig | undefined`, from Task 1) and `createCmsApp`'s `rateLimit` option (Task 2).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing codegen test**

Create `packages/cli/tests/server-entries.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { appSetup } from '../src/codegen/server-entries.js'

describe('appSetup codegen', () => {
  it('threads config.api.rateLimit into the generated createCmsApp call', () => {
    expect(appSetup()).toContain(
      '...(config.api.rateLimit ? { rateLimit: config.api.rateLimit } : {})',
    )
  })
})
```

- [ ] **Step 2: Run the codegen test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test server-entries`
Expected: FAIL — `appSetup` is not exported, and/or the generated string does not contain the rateLimit passthrough.

- [ ] **Step 3: Export `appSetup` and thread rateLimit into the generated app**

In `packages/cli/src/codegen/server-entries.ts`:

(a) Change `function appSetup(): string {` to `export function appSetup(): string {`.

(b) Inside the `createCmsApp({ ... })` template literal in `appSetup`, add the rateLimit passthrough line directly after the existing media line. The generated block becomes:

```typescript
const { app } = createCmsApp({
  name: config.name,
  registry: schemaRegistry,
  db: dbAdapter.getDb(),
  storage: config.storage,
  prefix: config.api.prefix,
  ...(config.api.media ? { media: config.api.media } : {}),
  ...(config.api.rateLimit ? { rateLimit: config.api.rateLimit } : {}),
})
```

- [ ] **Step 4: Run the codegen test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test server-entries`
Expected: PASS.

- [ ] **Step 5: Write the failing dev-wiring test**

In `packages/cli/tests/dev.test.ts`, add this test inside the `describe('runDev', ...)` block (after the existing `'calls all key startup steps when existing admin is present'` test). It overrides `resolveConfig` to include `rateLimit` and asserts `createCmsApp` received it:

```typescript
  it('forwards config.api.rateLimit to createCmsApp', async () => {
    vi.mocked(resolveConfig).mockResolvedValue({
      ...MOCK_CONFIG,
      api: { prefix: '/api', rateLimit: { findAll: '*' } },
    } as never)
    const db = makeDb([{ rows: [{ count: 1 }] }])
    vi.mocked(connectDb).mockResolvedValue(db as never)

    await runDev({}, { cwd: FAKE_CWD })

    expect(createCmsApp).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimit: { findAll: '*' } }),
    )
  })
```

- [ ] **Step 6: Run the dev test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test dev.test`
Expected: FAIL — `createCmsApp` was called without a `rateLimit` property.

- [ ] **Step 7: Forward rateLimit at both `createCmsApp` call sites in dev.ts**

In `packages/cli/src/commands/dev.ts`, add the same conditional-spread line to **both** `createCmsApp({ ... })` calls — the initial one (~line 157) and the hot-swap rebuild in `onSchemaFileChange` (~line 304). After the existing media spread line, add:

```typescript
    ...(config.api.rateLimit ? { rateLimit: config.api.rateLimit } : {}),
```

So each call becomes:

```typescript
  const adapter = createCmsApp({
    name: config.name,
    registry,
    db: db.getDb(),
    storage: config.storage,
    ...(config.api.prefix ? { prefix: config.api.prefix } : {}),
    ...(config.api.media?.max_file_size ? { media: { max_file_size: config.api.media.max_file_size } } : {}),
    ...(config.api.rateLimit ? { rateLimit: config.api.rateLimit } : {}),
  })
```

(The second call uses `const newAdapter = createCmsApp({ ... })` — apply the identical rateLimit line there too.)

- [ ] **Step 8: Run the dev test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test dev.test`
Expected: PASS — including the existing dev tests and the new `forwards config.api.rateLimit` test.

- [ ] **Step 9: Typecheck the cli package**

Run: `pnpm --filter @bobbykim/manguito-cms-cli exec tsc --noEmit`
Expected: no type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/cli/src/commands/dev.ts packages/cli/src/codegen/server-entries.ts packages/cli/tests/dev.test.ts packages/cli/tests/server-entries.test.ts
git commit -m "feat(cli): forward config.api.rateLimit through dev and build codegen"
```

---

### Task 4: End-to-end integration — `findAll: '*'` disables the list limiter

**Files:**
- Modify: `packages/api/src/__tests__/rate-limit.integration.test.ts` (add a helper + a test)

**Interfaces:**
- Consumes: `createCmsApp`'s `rateLimit` option (Task 2), specifically the `findAll: '*'` disable path.
- Produces: nothing.

> **Note:** This suite is DB-backed — it throws at import time unless `DB_URL` is set in `.env.test`. Run it against the test Postgres the other integration tests use.

- [ ] **Step 1: Add a disabled-limiter app helper**

In `packages/api/src/__tests__/rate-limit.integration.test.ts`, directly after the existing `makeApp()` helper (ends at line 125), add:

```typescript
// A second app whose list limiter is disabled via the '*' wildcard.
function makeUnlimitedApp() {
  const { app } = createCmsApp({
    storage: createLocalAdapter(),
    registry: TEST_REGISTRY,
    db,
    rateLimit: {
      findAll: '*',
    },
  })
  return app
}
```

- [ ] **Step 2: Write the failing test**

Inside the existing `describe('rate limiting — integration', ...)` block, add:

```typescript
  it("findAll: '*' disables the list limiter — many rapid requests all return 200", async () => {
    const app = makeUnlimitedApp()
    const statuses: number[] = []

    // Far more than the default per-IP budget (30) — none should be limited.
    for (let i = 0; i < 40; i++) {
      const res = await app.request(`/api/${BASE_PATH}`)
      statuses.push(res.status)
    }

    expect(statuses.every((s) => s === 200)).toBe(true)
    expect(statuses).toHaveLength(40)
  })
```

- [ ] **Step 3: Run the integration test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test rate-limit.integration`
Expected: PASS — the new test plus the two existing rate-limit integration tests. (The disable behavior is already implemented in Task 2; this test locks in the end-to-end contract. If it fails, the limiter is still being registered when `findAll === '*'` — debug `resolveListRateLimit` and the `app.ts` wiring.)

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/__tests__/rate-limit.integration.test.ts
git commit -m "test(api): verify findAll '*' disables the list rate limiter end-to-end"
```

---

### Task 5: Document the option in the sandbox config

**Files:**
- Modify: `apps/sandbox/manguito.config.ts:51-54`

**Interfaces:**
- Consumes: `createAPIAdapter`'s `rateLimit` option (Task 1).
- Produces: nothing.

- [ ] **Step 1: Add a commented `rateLimit` example**

In `apps/sandbox/manguito.config.ts`, replace the `api: createAPIAdapter({ ... })` block with:

```typescript
  api: createAPIAdapter({
    prefix: '/api',
    media: { max_file_size: 4 * 1024 * 1024 },
    // Rate limiting for public list endpoints (paginated collections).
    // Defaults: 30 req/IP and 500 req global per 60s window when omitted.
    //   rateLimit: { findAll: { windowMs: 60_000, maxPerIp: 30, maxGlobal: 500 } },
    // Set findAll to '*' to disable the list-endpoint limiter entirely:
    //   rateLimit: { findAll: '*' },
  }),
```

- [ ] **Step 2: Typecheck the sandbox app**

Run: `pnpm --filter sandbox exec tsc --noEmit`
Expected: no type errors. (If the sandbox has no `test`/`typecheck` script, run `pnpm build` at the repo root instead and confirm the sandbox compiles.)

- [ ] **Step 3: Commit**

```bash
git add apps/sandbox/manguito.config.ts
git commit -m "docs(sandbox): show rateLimit config and '*' disable in manguito.config.ts"
```

---

### Final verification (run after all tasks)

- [ ] **Full test suite**

Run: `pnpm test`
Expected: all packages pass (unit tests always; integration tests require `DB_URL` in `.env.test`).

- [ ] **Full build in dependency order**

Run: `pnpm build`
Expected: `core → db → api → admin → cli` all build with no type errors, confirming the new `core` type resolves across package boundaries.

---

## Self-Review

**1. Spec coverage.**
- "Wire rateLimit from `manguito.config.ts`" → Tasks 1 (factory + core type) and 3 (both call sites). ✅
- "`*` wildcard disables the rate limiter" → Task 2 (`resolveListRateLimit` returns `undefined` for `'*'`), verified end-to-end in Task 4. ✅
- "Applies to the public list-endpoint limiter only; login limiter stays always-on" → the wildcard lives on `findAll`, which only feeds `listRateLimit`; the login limiter in `routes/admin/auth.ts` is untouched. ✅

**2. Placeholder scan.** No `TBD`/`handle edge cases`/`similar to Task N`. Every code step shows complete code; every run step shows the command and expected result. ✅

**3. Type consistency.**
- `ResolvedRateLimitConfig` defined in Task 1 (core), consumed by name in Tasks 1 (`createAPIAdapter`), 2 (`resolveListRateLimit`, `CreateCmsAppOptions.rateLimit`). Same `findAll?: '*' | { windowMs?; maxPerIp?; maxGlobal? }` shape throughout. ✅
- `resolveListRateLimit(rateLimit?): MiddlewareHandler | undefined` — signature defined in Task 2 and used unchanged in `app.ts`. ✅
- The `undefined` return contract matches the existing `listRateLimit?: MiddlewareHandler` registrator guards (verified in `content.ts` and `media.ts`). ✅
- Defaults (60_000 / 30 / 500) moved from `app.ts` into `rate-limit.ts` and referenced only there — no duplicated magic numbers. ✅

**Assumptions to confirm during execution:**
- The exact `export type { ... } from './config/types.js'` form in `packages/core/src/index.ts` (Task 1, Step 4) — mirror the existing `APIAdapter` export line rather than assuming the specifier.
- The second `createCmsApp` call in `dev.ts` (Task 3, Step 7) is at ~line 304; confirm by name (`const newAdapter = createCmsApp(`).
