# Admin Static Cache-Control + Stale-Shell Diagnosis Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Task 1 is a code change (TDD via codegen assertions); Task 2 is an operator-run diagnostic + cache-bust.

**Goal:** Stop browsers (and any cache layer) from serving a stale admin SPA shell after a deploy — the cause of the persistent inline-script CSP error even though the current build has no inline script — by serving `index.html` with `no-cache` and the hashed `/assets/*` with long-lived `immutable` caching. Plus a decisive diagnostic to confirm whether the live server or the browser holds the stale copy.

**Background / diagnosis:**
- The freshly-built `apps/sandbox/dist/admin/index.html` has **no inline script** (only the external `<script type="module" src>`), so the reported inline script (`sha256-ieoeWcz…`, the old Vite polyfill) is a **stale copy**, not current code.
- The admin static handlers in `packages/cli/src/codegen/server-entries.ts` set **no `Cache-Control`** — only `Content-Type`. Browsers therefore heuristically cache `index.html` and may serve the old shell without revalidating. The "fonts fixed but script not" symptom fits a **stale HTML body + fresh runtime CSP header**.
- No service worker is involved (none registered in the admin).
- The FOUC console *warning* is benign (a reflow-before-stylesheet notice) and out of scope.

## Global Constraints

- TypeScript strict; the codegen emits server code as template strings (expected — not a "no JS" violation).
- Do not weaken the CSP or change any security header — this is purely `Cache-Control` on static responses.
- `index.html` / SPA-fallback → must always revalidate (`no-cache`), so a new deploy's shell (referencing new hashed assets) is picked up immediately.
- Hashed build assets (`/admin/assets/*`, content-hashed by Vite) → safe to cache forever (`immutable`).

## File Structure

- `packages/cli/src/codegen/server-entries.ts` — **modify.** Add `Cache-Control` to the two admin static handlers (node `serverEntry` admin block + the shared `adminStaticRoute` used by Lambda/Vercel).
- `packages/cli/tests/server-entries.test.ts` — **modify.** Assert the generated handlers set the cache headers.

---

### Task 1: Serve the admin shell `no-cache` and hashed assets `immutable`

**Files:**
- Modify: `packages/cli/src/codegen/server-entries.ts` (node `serverEntry` admin block; shared `adminStaticRoute`)
- Test: `packages/cli/tests/server-entries.test.ts`

**Interfaces:** none changed — internal codegen only.

**Cache rule (both handlers):** if the resolved request path is under the assets dir (contains `/assets/`), send `Cache-Control: public, max-age=31536000, immutable`; otherwise (the SPA shell / `index.html` fallback, favicon, etc.) send `Cache-Control: no-cache`.

- [ ] **Step 1: Write the failing test**

In `packages/cli/tests/server-entries.test.ts`, add to the static-serving describe block:

```typescript
it('sets no-cache on the admin shell and immutable on hashed assets', () => {
  const node = serverEntry({ adminPrefix: '/admin', apiPrefix: '/api' })
  const shared = adminStaticRoute('/admin')
  // both handlers must emit both cache directives
  for (const src of [node, shared]) {
    expect(src).toContain("public, max-age=31536000, immutable")
    expect(src).toContain("no-cache")
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test server-entries`
Expected: FAIL — no `Cache-Control` strings in the generated handlers.

- [ ] **Step 3: Add Cache-Control to the node `serverEntry` admin block**

In the node `serverEntry` admin handler (the `if (path.startsWith(ADMIN_PREFIX)) { … }` block), set the header based on whether the served path is a hashed asset. After computing `filePath` and before/with the `Content-Type` set, add:

```javascript
      const isAsset = path.startsWith(ADMIN_PREFIX + '/assets/')
      res.setHeader('Cache-Control', isAsset ? 'public, max-age=31536000, immutable' : 'no-cache')
      res.setHeader('Content-Type', ADMIN_MIME[extname(filePath).slice(1).toLowerCase()] ?? 'application/octet-stream')
```

(Use `path` — the request path already in scope — for the asset test, not `filePath`, since the SPA fallback rewrites `filePath` to `index.html` while the request path may still be an asset miss; a request under `/admin/assets/` that misses should still not be cached as the shell. Keying on the request path is correct: real hashed assets live under `/admin/assets/` and exist; the shell fallback is served for non-asset routes.)

- [ ] **Step 4: Add Cache-Control to the shared `adminStaticRoute`**

In `adminStaticRoute`'s `app.get(\`\${ADMIN_PREFIX}/*\`, …)` handler, build the response headers with the same rule:

```javascript
  const isAsset = c.req.path.startsWith(ADMIN_PREFIX + '/assets/')
  const data = await readFile(filePath)
  return new Response(data, {
    headers: {
      'Content-Type': ADMIN_MIME[extname(filePath).slice(1).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
  })
```

(Keep the existing `try/catch` returning `c.text('Not found', 404)`.)

- [ ] **Step 5: Run to verify it passes + typecheck**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test server-entries && pnpm --filter @bobbykim/manguito-cms-cli exec tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 6: Rebuild + verify the generated server actually emits the headers**

Run: `pnpm --filter @bobbykim/manguito-cms-cli build && pnpm --filter sandbox build`
Then confirm the generated server carries the directives:

Run: `grep -o "Cache-Control[^,}]*" apps/sandbox/dist/generated/server.ts 2>/dev/null | head; grep -ro "immutable" apps/sandbox/dist/generated/*.ts | head`
Expected: `no-cache` and `immutable` appear in the generated `server.ts` / `handler.ts` / `vercel.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/codegen/server-entries.ts packages/cli/tests/server-entries.test.ts
git commit -m "fix(cli): cache-control on admin static — no-cache shell, immutable assets

Admin index.html was served with no Cache-Control, so browsers could serve a
stale SPA shell after a deploy (persistent inline-script CSP error from an old
bundle). Shell now revalidates; hashed /assets/* cache long-term."
```

---

### Task 2: Diagnose stale source + clear it (operator-run)

No source change. Determines whether the stale shell lives in the **deployed image** or the **browser**, and clears it. Do this after Task 1 is built + redeployed.

- [ ] **Step 1: Ask the live server what it actually serves (bypasses browser cache)**

```bash
curl -s https://<lambda-url>/admin/ | grep -o "<script[^>]*>"
curl -s https://<lambda-url>/admin/ | grep -o "index-[A-Za-z0-9_-]*\.js"
```
Compare the bundle hash to the freshly built one (`apps/sandbox/dist/admin/index.html` → currently `index-DI1k49w8.js`).

- **Inline `<script>` present, OR bundle hash differs from the fresh build →** the **deployed image is stale** (didn't rebuild the admin). Go to Step 2.
- **No inline `<script>` and the hash matches the fresh build →** the server is fine; the stale copy is in the **browser**. Skip to Step 3.

- [ ] **Step 2: Force a clean image rebuild + redeploy (only if the server is stale)**

The Lambda is a Docker image asset (`infra/lib/lambda-stack.ts` → `DockerImageCode.fromImageAsset(repoRoot, { target: 'lambda' })`). Force it to rebuild from fresh source rather than reuse a cached image:

```bash
docker builder prune -f        # drop cached layers
# then redeploy so CDK rebuilds the image
cd infra && cdk deploy <LambdaStack>
```
Confirm CDK actually publishes a **new image digest** (watch the build run; the ECR asset tag should change). Then re-run Step 1 and confirm no inline script + matching bundle hash.

- [ ] **Step 3: Clear the browser copy**

- Hard reload (DevTools open → Network → "Disable cache", then reload), or test in a **private window**.
- With Task 1 deployed, `index.html` now returns `Cache-Control: no-cache`, so after one clean load the browser will revalidate the shell on every future deploy — this class of staleness won't recur.

- [ ] **Step 4: Final confirmation in the browser**

Load `/admin` fresh and confirm:
- No `script-src` inline-script error.
- No `font-src` errors (already fixed).
- Media upload's presigned PUT to S3 succeeds.
- (The FOUC *warning* may still appear — benign, ignore.)

---

## Self-Review

- **Persistent inline-script error → Task 1** (durable: `no-cache` shell so a stale bundle can't be served after deploy) **+ Task 2** (clears the currently-stale copy, in image or browser). ✅
- **FOUC warning →** diagnosed as benign; intentionally not addressed. ✅
- **No security regression:** only `Cache-Control` added to static responses; CSP and other headers untouched. ✅
- **Correctness of the cache rule:** hashed assets under `/admin/assets/` are content-addressed (safe to cache immutably); the shell must revalidate so new asset hashes are picked up — standard Vite SPA caching. ✅

**Assumption to confirm during execution:** that keying the asset test on the request path (`/admin/assets/`) matches how Vite emits assets under `base` — confirm the built `apps/sandbox/dist/admin/assets/` path and the `base: '/admin/'` config in `packages/cli/src/commands/build.ts` (it sets `base: config.admin.prefix + '/'`), so hashed assets are requested at `/admin/assets/*`.

## Execution Handoff

Task 1 is a small codegen change — suitable inline or via one subagent. Task 2 is operator-run (redeploy + browser). Recommend: apply Task 1, redeploy, then run Task 2's `curl` diagnostic to confirm the stale copy is gone.
