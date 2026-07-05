# Deploying to Vercel

This documents the requirements for deploying the Manguito CMS sandbox to
Vercel, and how they differ from [Fargate](./fargate.md) and
[Lambda](./lambda.md). Unlike those two — where we build and push a
container/zip ourselves — **Vercel runs its own build**, and the deployable
unit is a source layout it understands, not an artifact we hand it. This took
several iterations of deploy → read runtime logs → fix, since several of the
failure modes only manifest on Vercel's actual infrastructure, not locally.

The sandbox is live at `https://sandbox-mocha-kappa.vercel.app` —
`/api/openapi.json`, `/api/blog`, `/admin`, and SPA-fallback routes
(`/admin/dashboard`) all verified working.

---

## Why this is a different problem

| | Fargate / Lambda | Vercel |
|---|---|---|
| **You control** | The container/zip — build it yourself, push it | Vercel builds it — you give it a build command + a file layout it recognizes |
| **Admin SPA static files** | Served via `fs.readFile` inside the same function/container | Vercel's docs state in-function static serving (Hono's `serveStatic()`, or any fs-read trick) isn't supported — static assets must sit where Vercel's CDN serves them directly |
| **Function discovery** | Anywhere — the Dockerfile `CMD` / zip entry decides | Must live under an `api/` directory at the **deployed project root** |
| **What gets uploaded** | We control the Docker build context | Whatever directory you run `vercel`/`vercel build` from — **not** automatically the whole monorepo |
| **Monorepo dependency resolution** | We write `RUN pnpm install` ourselves | Vercel's own install step, then its own tracer (`@vercel/nft`) for bundling the function |

---

## Prerequisites

- A Vercel account, with the CLI authenticated (`vercel login`, or `vercel
  whoami` if a browser session already exists — note this can silently
  complete a device-login flow with no further prompts, and even a plain
  `vercel build` can silently create a real (empty) project as a side effect
  of linking)
- The same values as `infra/.env` (`DB_URL`, `AUTH_SECRET`, `S3_BUCKET`,
  `AWS_REGION`, `ALLOWED_ORIGIN`), set as **Vercel Project Environment
  Variables** for all three targets (production/preview/development) —
  `manguito build` validates `DB_URL` eagerly at config-load time, so the
  build itself fails without it, not just the running function
- **S3 credentials.** Unlike Lambda/Fargate, Vercel has no AWS execution role,
  so the SDK cannot sign presigned upload URLs and `/admin/api/media/presigned-url`
  returns `502`. Provide an IAM user's keys (with `s3:PutObject` on the bucket)
  as `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, plus `S3_REGION` (the bucket's
  region — `AWS_REGION` on Vercel is the platform's region, not the bucket's).
  Custom names are required because the underlying Lambda runtime reserves the
  `AWS_` prefix, so `AWS_ACCESS_KEY_ID` cannot be set. Add the bucket's Vercel
  origin to the S3 bucket CORS `AllowedOrigins`.

---

## Final layout

```
manguito-cms/
├── vercel.json          ← at the REPO ROOT, not apps/sandbox
├── api/
│   └── index.ts          ← at the REPO ROOT, not apps/sandbox/api
└── apps/sandbox/
    ├── package.json       (build:vercel script)
    └── dist/               (generated — vercel.js, admin/*)
```

Both `vercel.json` and `api/` had to move from `apps/sandbox/` to the repo
root after the first real deploy attempt — see issue 1 below for why.

---

## Issues encountered and fixes applied

### 1. 404 on every route — only the app subdirectory gets uploaded, not the monorepo

**Symptom**

A real deploy succeeds (`READY` status), but every route returns 404, and
the build log shows `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND No package.json
was found in "/"`.

**Root cause**

`vercel build`/`vercel deploy` were run from `apps/sandbox`, with
`vercel.json` living there too. The CLI uploads **whatever directory you
invoke it from** as the entire deployment source — it does not walk up to
include sibling directories. Since `packages/*` lives outside
`apps/sandbox`, the uploaded tree never contained them, and the
`buildCommand`'s `cd ../..` walked out of the uploaded tree entirely,
landing at the filesystem root.

The official "Root Directory" project setting (used in the dashboard / Git
integration flow) only works because Vercel clones the **full repo via
git** first, then changes into Root Directory before running commands —
that path doesn't apply to a plain CLI deploy of a subdirectory.

**Fix**

Move `vercel.json` and `api/` to the **monorepo root**, and run all `vercel`
commands from there instead of from `apps/sandbox`:

```json
// vercel.json (repo root)
{
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm run build:packages && pnpm --filter sandbox run build:vercel",
  "outputDirectory": "apps/sandbox/public"
}
```

No more `cd ../..` needed — the working directory during build is already
the repo root, since that's now what got uploaded.

---

### 2. Build failed with `MODULE_NOT_FOUND` for the CLI's own `dist/index.js`

**Symptom** (reproduced locally first, by deleting all workspace package
`dist/` output to simulate Vercel's clean checkout)

```
Error: Cannot find module '/.../apps/sandbox/node_modules/@bobbykim/manguito-cms-cli/dist/index.js'
```

On the actual Vercel build machine, the same root cause manifested as
`exited with SIGKILL` instead of a clean error — a different symptom for the
same underlying problem.

**Root cause**

`build:vercel` (`manguito build && ...`) only builds the **sandbox** app. It
never builds `core`/`db`/`api`/`admin`/`cli` first. On this local machine
those packages' `dist/` already existed from earlier work in the session,
masking the problem entirely — Vercel's clean checkout has none of that.
This is the exact same ordering issue the Dockerfile's `builder` stage
already solves for Fargate/Lambda, just never carried over here.

**Fix**

Added a root `build:packages` script mirroring the Dockerfile's build order,
plus a `pnpm install` to fix the `manguito` bin symlink (same reason as
[fargate.md](./fargate.md) issue 4):

```json
// package.json (repo root)
"build:packages": "pnpm --filter @bobbykim/manguito-cms-core run build && pnpm --filter @bobbykim/manguito-cms-db run build && pnpm --filter @bobbykim/manguito-cms-api run build && pnpm --filter @bobbykim/manguito-cms-admin run build && pnpm --filter @bobbykim/manguito-cms-cli run build && pnpm install --frozen-lockfile"
```

`vercel.json`'s `buildCommand` calls `pnpm run build:packages` before
building sandbox. (This was first inlined directly into `buildCommand`, but
that hit a separate limit — see issue 3.)

---

### 3. `projectSettings.buildCommand` should NOT be longer than 256 characters

**Symptom**

```
Invalid request: `projectSettings.buildCommand` should NOT be longer than 256 characters.
```

This only happens on a real `vercel deploy` — `vercel build` (local-only)
doesn't validate this, so it's easy to miss until a real deploy attempt.

**Root cause**

The full explicit per-package build sequence inlined directly into
`buildCommand` exceeded Vercel's 256-character limit on that field.

**Fix**

Moved the sequence into the root `build:packages` script (issue 2) so
`buildCommand` stays short: `"pnpm run build:packages && pnpm --filter
sandbox run build:vercel"`.

---

### 4. `vercel env add` silently stored empty values

**Symptom**

`vercel env add DB_URL production` (piped a value via `echo "$val" |
vercel env add ...`) reported success, but `vercel env pull` later showed
`DB_URL=""` — and the subsequent build failed with `DB_URL_MISSING`.

**Root cause**

Piping a value into `vercel env add <name> <env>` via stdin did not
reliably populate the value across all three targets in this CLI version —
some combination of interactive prompts and piped stdin produced empty
strings without surfacing an error.

**Fix**

Use the explicit `--value` flag for fully non-interactive, verified input:

```bash
vercel env add DB_URL production --value "postgresql://..." --yes
```

Verified by immediately re-running `vercel env pull` and checking the
resulting file — don't trust the "success" message alone.

---

### 5. `vercel build` defaults to the `preview` target — mismatched with a `--prod` deploy

**Symptom**

```
Error: The "--prebuilt" option was used with the target environment "production",
but the prebuilt output found in ".vercel/output" was built with target environment "preview".
```

**Root cause**

`vercel build` (no flags) always targets `preview`, reading
`.vercel/.env.preview.local`. Deploying that prebuilt output with `--prod`
mismatches the target it was built for.

**Fix**

Match the build and deploy targets:

```bash
vercel pull --yes --environment=production
vercel build --prod --yes
vercel deploy --prebuilt --prod --yes
```

Also: `vercel build` only auto-pulls env vars into `.vercel/.env.<target>.local`
the *first* time a directory is linked. After that file is deleted (e.g. to
test a clean state), it has to be explicitly re-pulled with `vercel pull
--yes --environment=<target>` before building again — `vercel build` won't
regenerate it on its own.

---

### 6. `Error [ERR_REQUIRE_ESM]` at runtime

**Symptom**

Every route returned `500 FUNCTION_INVOCATION_FAILED`. Runtime logs (`vercel
logs <url>`) showed:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module ... not supported
```

**Root cause**

`api/index.ts` used `export { default } from '../apps/sandbox/dist/vercel.js'`.
The repo-root `package.json` has no `"type": "module"`, so Vercel's bundler
compiles `api/index.ts` as CommonJS — and a static `export ... from` becomes
a `require()` call. `dist/vercel.js` is genuine ESM (`apps/sandbox`'s
`package.json` has `"type": "module"`), and CommonJS can't `require()` an
ESM file.

Renaming the file to `api/index.mts` (to force ESM regardless of
`package.json`) was tried first, but Vercel's `api/` function-discovery
glob doesn't recognize `.mts` — no function was created at all.

Adding `"type": "module"` to the repo-root `package.json` would also fix
it, but was avoided — that's a repo-wide change with a much bigger blast
radius (every tool that reads the root `package.json`) just to satisfy one
function's import.

**Fix**

Use a dynamic `import()` instead of a static re-export. `import()` works
from a CommonJS module regardless of the imported file's module format,
since module resolution happens at runtime, not compile time:

```typescript
// api/index.ts
export default {
  async fetch(request: Request): Promise<Response> {
    const mod = await import('../apps/sandbox/dist/vercel.js')
    return mod.default(request)
  },
}
```

---

### 7. Requests hung until a 300-second timeout, then 504

**Symptom**

After fixing issue 6, every route returned `504` after a long hang. Runtime
logs showed:

```
WARN: default export returned a `Response`.
The default-export signature is `(req, res) => void` — returns are ignored.
You likely meant the Web `fetch`-style API.
```

```
Vercel Runtime Timeout Error: Task timed out after 300 seconds
```

**Root cause**

A bare `export default async function handler(request) { ... return response }`
is ambiguous with Vercel's **legacy** Node signature, `(req, res) => void`.
Vercel interpreted it that way: called the function with Node-style `(req,
res)` objects, got back a `Response` object (which the legacy signature
ignores — you're expected to call `res.end()` instead of returning), and
since nothing ever wrote to `res`, the request hung until the function
timeout.

**Fix**

Export an object with a `fetch` method instead of a bare function — this is
the unambiguous Web Standard signature:

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const mod = await import('../apps/sandbox/dist/vercel.js')
    return mod.default(request)
  },
}
```

This was the last fix needed — all routes returned correct responses
immediately afterward.

---

## Final `api/index.ts` and `vercel.json`

```typescript
// api/index.ts
export default {
  async fetch(request: Request): Promise<Response> {
    const mod = await import('../apps/sandbox/dist/vercel.js')
    return mod.default(request)
  },
}
```

```json
// vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm run build:packages && pnpm --filter sandbox run build:vercel",
  "outputDirectory": "apps/sandbox/public",
  "rewrites": [
    { "source": "/admin/api/(.*)", "destination": "/api/index" },
    { "source": "/api/(.*)", "destination": "/api/index" },
    { "source": "/api", "destination": "/api/index" },
    { "source": "/admin/(.*)", "destination": "/admin/index.html" },
    { "source": "/admin", "destination": "/admin/index.html" }
  ]
}
```

Rewrite ordering matters: `/admin/api/(.*)` must be listed before the
broader `/admin/(.*)` SPA-fallback rule, or admin API calls would get
rewritten to `/admin/index.html` instead of reaching the function. Static
files always take precedence over rewrites regardless of order (Vercel
checks the filesystem first).

`apps/sandbox/package.json`'s `build:vercel` script stages the built admin
SPA into the static output directory:

```json
"build:vercel": "manguito build && rm -rf public && mkdir -p public/admin && cp -r dist/admin/. public/admin/"
```

No `--env .env` here, unlike the other `build`/`dev`/`start` scripts — on
Vercel, env vars are injected directly into `process.env` by the platform.

---

## The deploy command

```bash
# from the monorepo root
vercel pull --yes --environment=production
vercel build --prod --yes
vercel deploy --prebuilt --prod --yes
```

`vercel pull` refreshes both project settings and the env var snapshot used
by the local build; `vercel build` produces `.vercel/output/` per the Build
Output API; `--prebuilt` deploys that exact output rather than re-running
the build remotely.

---

## Files changed from the baseline

| File | Change |
|------|--------|
| `vercel.json` | New, at repo root |
| `api/index.ts` | New, at repo root — dynamic-import wrapper exporting `{ fetch }` |
| `package.json` | Added `build:packages` script |
| `apps/sandbox/package.json` | Added `build:vercel` script |
| `.gitignore` | Added `.vercel/` and `apps/sandbox/public/` |

---

## Final verification

```bash
curl -s -o /dev/null -w "%{http_code}" https://sandbox-mocha-kappa.vercel.app/api/openapi.json   # 200
curl -s https://sandbox-mocha-kappa.vercel.app/admin/api/config                                    # 401 UNAUTHORIZED
curl -s -o /dev/null -w "%{http_code}" https://sandbox-mocha-kappa.vercel.app/admin               # 200
curl -s -o /dev/null -w "%{http_code}" https://sandbox-mocha-kappa.vercel.app/admin/dashboard     # 200 (SPA fallback)
```
