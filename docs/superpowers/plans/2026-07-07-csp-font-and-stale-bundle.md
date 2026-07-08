# CSP Font Fix + Stale-Bundle Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Task 1 is a code change; Task 2 is an operator-run deploy/verify procedure.

**Goal:** Unblock the `data:`-URI fonts the CSP is rejecting (`font-src 'self' data:`), and provide a clean-rebuild + cache-bust procedure that clears the stale admin bundle responsible for the lingering inline-script CSP error.

**Background (diagnosis):** After the CSP admin-compat fix and redeploy, two errors remain:
1. **Fonts blocked (real):** Vite's default `assetsInlineLimit` (4 KB) inlines the small `@fontsource` subset files as `data:font/woff2;base64,…` in the built CSS (verified: 9 inlined, 23 emitted as files in `apps/sandbox/dist/admin/assets`). The CSP's `font-src 'self'` forbids `data:`, so those 9 are blocked.
2. **Inline script blocked (stale bundle, not a code bug):** the error names the *same* hash as the original pre-fix report (`sha256-ieoeWcz…`), but the current `manguito build` artifact (`apps/sandbox/dist/admin/index.html`) has **no inline script** — the deployed/browser-cached page is the old bundle. Fix is deploy hygiene, not code.
3. **FOUC warning:** cosmetic, aggravated by the blocked fonts; expected to subside once fonts load.

**Decision (settled with the user):** allow `data:` in `font-src` — reliable regardless of bundler behavior; `data:` is safe for fonts (the data: risk applies to `script-src`/`object-src`/`frame-src`, not fonts).

## Global Constraints

- Do NOT weaken `script-src` (stays `'self'`, no `'unsafe-inline'`, no `data:`). `data:` is added ONLY to `font-src`.
- `connect-src` stays least-privilege (`'self'` + storage origin) — unchanged.
- TypeScript strict; existing tests must stay green.

---

### Task 1: Allow `data:` fonts in the CSP

**Files:**
- Modify: `packages/api/src/middleware/security-headers.ts`
- Modify: `packages/api/src/middleware/__tests__/security-headers.test.ts`
- Modify: `docs/adr/api/0010-config-driven-csp.md`

**Interfaces:** unchanged — `createSecurityHeadersMiddleware({ connectSrc? })` signature is the same; only the `font-src` directive value changes.

- [ ] **Step 1: Update the failing test**

In `packages/api/src/middleware/__tests__/security-headers.test.ts`, change the `font-src` assertion (currently `expect(csp).toContain("font-src 'self'")`) to require the `data:` source:

```typescript
expect(csp).toContain("font-src 'self' data:")
```

(If that assertion lives in the "connect-src defaults" test, keep it there; otherwise add it to the existing header test. Any test asserting the bare `"font-src 'self'"` substring still passes since it remains a substring.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test security-headers`
Expected: FAIL — current directive is `font-src 'self'` (no `data:`).

- [ ] **Step 3: Add `data:` to the `font-src` directive**

In `packages/api/src/middleware/security-headers.ts`, change the `font-src` line in the CSP array:

```typescript
    "font-src 'self' data:",
```

(Leave every other directive unchanged — `script-src 'self'`, `connect-src`, etc.)

- [ ] **Step 4: Run to verify it passes + full suite + typecheck**

Run: `pnpm --filter @bobbykim/manguito-cms-api test security-headers && pnpm --filter @bobbykim/manguito-cms-api test && pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit`
Expected: PASS (security-headers tests + full api suite green, no type errors).

- [ ] **Step 5: Note the reason in ADR api/0010**

In `docs/adr/api/0010-config-driven-csp.md`, under Consequences, append:

```markdown
- `font-src` allows `'self' data:`: the admin self-hosts fonts via `@fontsource`,
  and Vite inlines the small per-subset `.woff2` files under `assetsInlineLimit`
  as `data:` URIs in the built CSS. `data:` is permitted only for fonts (never
  `script-src`/`object-src`), which carries no script-execution risk.
```

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/middleware/security-headers.ts packages/api/src/middleware/__tests__/security-headers.test.ts docs/adr/api/0010-config-driven-csp.md
git commit -m "fix(api): allow data: fonts in CSP font-src

Vite inlines small @fontsource subset woff2 files as data: URIs; font-src
'self' was blocking them. data: is permitted for fonts only. Refs ADR api/0010."
```

---

### Task 2: Clean rebuild + deploy verification (operator-run — clears the stale inline-script bundle)

This task has no source change. Its purpose is to guarantee the deployed admin is the *fresh* bundle (no inline polyfill script) rather than a cached/stale one.

- [ ] **Step 1: Clean rebuild from a clean tree**

Remove stale build outputs and the Turborepo cache so nothing is served from a pre-fix cache, then rebuild:

```bash
rm -rf apps/sandbox/dist .turbo packages/*/.turbo
pnpm build
```

- [ ] **Step 2: Verify the freshly built admin has no inline script and no data-blocked config**

```bash
grep -o "<script[^>]*>" apps/sandbox/dist/admin/index.html
```
Expected: only `<script type="module" crossorigin src="/admin/assets/index-*.js">` — **no bare `<script>` without `src`**.

```bash
grep -c "fonts.googleapis.com" apps/sandbox/dist/admin/index.html
```
Expected: `0`.

- [ ] **Step 3: Redeploy from the fresh build**

Redeploy the Lambda (whatever your deploy path is — e.g. `cdk deploy <LambdaStack>` from `infra/`) **after** the clean `pnpm build`, so the function packages the fresh `apps/sandbox/dist`. Confirm the deploy step actually re-uploaded the admin assets (the `dist/admin/assets/index-*.js` filename hash should differ from the previously deployed one).

- [ ] **Step 4: Verify the LIVE deployment (not a cached page)**

Fetch the served HTML directly (bypasses browser cache):

```bash
curl -s https://<your-lambda-url>/admin/ | grep -o "<script[^>]*>"
```
Expected: only the external `type="module" src=...` script — no inline `<script>`. If an inline `<script>` is still served, the deploy did not ship the fresh bundle (re-check the build/deploy packaging).

- [ ] **Step 5: Hard-reload the browser**

Load `/admin` with cache disabled (DevTools → Network → "Disable cache", or a hard reload / private window). Confirm:
- No `script-src` inline-script CSP error.
- No `font-src` errors (the `data:` fonts now load — Task 1).
- Fonts render; the FOUC warning should be gone or reduced.
- Media upload: the presigned PUT to `https://<bucket>.s3.<region>.amazonaws.com` succeeds (the earlier `connect-src` fix).

---

## Self-Review

- **Font error → Task 1** (`font-src 'self' data:`), covered by a middleware unit test. ✅
- **Inline-script error → Task 2** (clean rebuild + cache-bust + live verification); confirmed no current code emits an inline script, so no code change is warranted — only fresh delivery. ✅
- **No policy weakening:** `data:` added to `font-src` only; `script-src` untouched. ✅
- **FOUC:** not separately addressed — expected to resolve once fonts load; revisit only if it persists after Task 1+2.

**Assumption to confirm:** that the live inline-script error is indeed a stale bundle (Task 2 Step 4 is the decisive check). If the live server serves a *fresh* `index.html` with no inline script yet the browser still errors, it is pure browser cache — resolved by Step 5. If a freshly built+deployed server genuinely serves an inline script, stop and investigate the CLI Vite build (`packages/cli/src/commands/build.ts:136`) config resolution — but the local artifact evidence says it will not.

## Execution Handoff

Task 1 is a one-line code change + test + ADR note — small enough to execute inline. Task 2 is operator-run (build + redeploy + browser verification). Recommend: apply Task 1, then run Task 2's clean-rebuild/redeploy to clear the stale bundle.
