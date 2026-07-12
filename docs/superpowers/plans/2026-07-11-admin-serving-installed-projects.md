# Admin Panel Serving in Installed Projects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `manguito dev`/`build` build the admin panel in installed (non-monorepo) projects by publishing the admin's Vite source and its build toolchain, and aligning the CLI on vite 8 — with no change to the dev/build/start lifecycle.

**Architecture:** The CLI already builds the admin by running Vite against the `@bobbykim/manguito-cms-admin` package directory (`dev` = `createServer` middleware, `build` = `viteBuild`). It fails in installed projects only because the published admin ships `dist/` only. The entire fix is packaging: publish the admin's Vite source, promote its build deps to `dependencies`, and bump the CLI's vite to match the admin's major (8). CLI serving code is untouched.

**Tech Stack:** pnpm workspace, tsup, Vite 8, Vue 3, Changesets. Spec: `docs/superpowers/specs/2026-07-11-admin-serving-installed-projects-design.md`.

## Global Constraints

- **Admin `files`** must be exactly: `["dist", "src", "public", "index.html", "vite.config.ts"]`. Do NOT publish `tsconfig.json` (it `extends ../../tsconfig.base.json`, a monorepo path; verified unnecessary for `viteBuild`).
- **Promote to admin `dependencies`** (from `devDependencies`), keeping exact version specifiers: `vite` `^8.1.3`, `@vitejs/plugin-vue` `^6.0.7`, `@tailwindcss/vite` `^4.3.2`, `tailwindcss` `^4.3.2`.
- **Keep in admin `devDependencies`:** `vue-tsc`, `tsup`, `vitest`, `@vue/test-utils`, `@testing-library/vue`, `jsdom`, `@types/jsdom`, `msw`, `dotenv-cli`, `typescript`.
- **CLI `vite`**: change `^6.4.3` → `^8.1.3` (match the admin's major). No other CLI change.
- **Do not modify** `packages/cli/src/commands/{dev,build,start}.ts` or `server-entries.ts` — serving logic is unchanged by design.
- Commits follow commitizen conventional-commits (`type(scope): subject`).
- Release: `@bobbykim/manguito-cms-admin` **minor**, `@bobbykim/manguito-cms-cli` **patch**, one changeset.

---

## Task 1: Admin package — publish Vite source + promote build deps

**Files:**
- Modify: `packages/admin/package.json` (`files`, `dependencies`, `devDependencies`)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**
- Produces: a `@bobbykim/manguito-cms-admin` package whose tarball contains the Vite source (`index.html`, `src/`, `public/`, `vite.config.ts`) alongside `dist/`, and whose `dependencies` include `vite`, `@vitejs/plugin-vue`, `@tailwindcss/vite`, `tailwindcss`. Consumed by the CLI's `viteBuild`/`createServer` in Task 3's e2e.

- [ ] **Step 1: Edit `files` and move build deps to `dependencies`**

In `packages/admin/package.json`:

Change:
```json
  "files": [
    "dist"
  ],
```
to:
```json
  "files": [
    "dist",
    "src",
    "public",
    "index.html",
    "vite.config.ts"
  ],
```

Move these four out of `devDependencies` and into `dependencies` (place them in the existing alphabetical `dependencies` block). Resulting `dependencies` block:
```json
  "dependencies": {
    "@bobbykim/manguito-cms-core": "workspace:*",
    "@fontsource/jetbrains-mono": "^5.2.8",
    "@fontsource/plus-jakarta-sans": "^5.2.8",
    "@tailwindcss/vite": "^4.3.2",
    "@tiptap/extension-link": "^2.27.2",
    "@tiptap/starter-kit": "^2.27.2",
    "@tiptap/vue-3": "^2.27.2",
    "@vitejs/plugin-vue": "^6.0.7",
    "@vueuse/core": "^12.8.2",
    "pinia": "^3.0.4",
    "tailwindcss": "^4.3.2",
    "vite": "^8.1.3",
    "vue": "^3.5.39",
    "vue-router": "^4.6.4"
  },
```
Resulting `devDependencies` block (the four removed):
```json
  "devDependencies": {
    "@testing-library/vue": "^8.1.0",
    "@types/jsdom": "^28.0.3",
    "@vue/test-utils": "^2.4.11",
    "dotenv-cli": "latest",
    "jsdom": "^29.1.1",
    "msw": "^2.15.0",
    "tsup": "^8.5.1",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10",
    "vue-tsc": "^3.3.7"
  }
```

- [ ] **Step 2: Refresh the lockfile**

Run:
```bash
cd /mnt/projects/manguito-cms
pnpm install
```
Expected: completes without error; `pnpm-lock.yaml` updated so `packages/admin` lists the four packages under `dependencies` (not `devDependencies`).

- [ ] **Step 3: Verify the packed tarball contains the Vite source**

Run:
```bash
cd /mnt/projects/manguito-cms/packages/admin
TGZ=$(pnpm pack | tail -1)
tar -tzf "$TGZ" | grep -E "package/(index.html|vite.config.ts|src/main.ts|public/|dist/index.js)$" | sort
```
Expected output includes all of: `package/index.html`, `package/vite.config.ts`, `package/src/main.ts`, `package/dist/index.js` (and `package/public/...`). Confirm `package/tsconfig.json` is **absent**:
```bash
tar -tzf "$TGZ" | grep -c "package/tsconfig.json$"   # expect 0
```

- [ ] **Step 4: Verify the admin builds from the packed source standalone (no monorepo)**

Run (proves the published source + promoted deps are self-sufficient outside the workspace):
```bash
cd /mnt/projects/manguito-cms/packages/admin
TGZ=$(ls bobbykim-manguito-cms-admin-*.tgz | tail -1)
WORK=$(mktemp -d)
tar -xzf "$TGZ" -C "$WORK"
cd "$WORK/package"
npm install --no-audit --no-fund
npx vite build --outDir /tmp/admin-standalone-out --emptyOutDir --logLevel warn
ls /tmp/admin-standalone-out/index.html && echo "STANDALONE ADMIN BUILD OK"
```
Expected: `vite build` exits 0 and prints `STANDALONE ADMIN BUILD OK`. (The `@bobbykim/manguito-cms-core` dep resolves from the registry; it is published.)

- [ ] **Step 5: Clean up and commit**

```bash
cd /mnt/projects/manguito-cms/packages/admin
rm -f bobbykim-manguito-cms-admin-*.tgz
cd /mnt/projects/manguito-cms
git add packages/admin/package.json pnpm-lock.yaml
git commit -m "feat(admin): publish Vite source + promote build deps for installed projects"
```

---

## Task 2: CLI — align on vite 8

**Files:**
- Modify: `packages/cli/package.json` (`dependencies.vite`)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: a CLI resolving `vite@8`, so `viteBuild`/`createServer` run against the admin's vite-8 plugins without a major skew. Used in Task 3's e2e.

- [ ] **Step 1: Bump the CLI's vite dependency**

In `packages/cli/package.json`, change:
```json
    "vite": "^6.4.3"
```
to:
```json
    "vite": "^8.1.3"
```

- [ ] **Step 2: Refresh the lockfile**

```bash
cd /mnt/projects/manguito-cms
pnpm install
```
Expected: no errors; `packages/cli` resolves `vite@8.1.3` in `pnpm-lock.yaml`.

- [ ] **Step 3: Build the CLI under vite 8**

```bash
cd /mnt/projects/manguito-cms
pnpm --filter @bobbykim/manguito-cms-cli build
```
Expected: tsup build succeeds (the CLI imports `build`/`createServer` from vite; confirms vite 8's types/exports resolve).

- [ ] **Step 4: Regression — sandbox admin build works under vite 8 (monorepo)**

The CLI's `viteBuild` uses the admin's config + plugins; this confirms vite 8 drives them.
```bash
cd /mnt/projects/manguito-cms
pnpm --filter @bobbykim/manguito-cms-cli build          # ensure dist/index.js current
pnpm --filter sandbox exec manguito build --env .env 2>&1 | tail -15
ls apps/sandbox/dist/admin/index.html && echo "SANDBOX ADMIN BUILD OK (vite 8)"
```
Expected: build reaches `✔ Admin panel compiled` and `apps/sandbox/dist/admin/index.html` exists. (Sandbox has a `.env`; the command loads it. If the build fails on a vite 8 API change, that is the migration issue to fix — the two call sites are `createViteServer({ root, server: { middlewareMode: true }, appType: 'spa', logLevel: 'warn' })` in `dev.ts` and `viteBuild({ root, base, build: { outDir, emptyOutDir }, define, logLevel: 'warn' })` in `build.ts`; both options exist in vite 8.)

- [ ] **Step 5: Run the CLI test suite (no regressions)**

```bash
cd /mnt/projects/manguito-cms
pnpm --filter @bobbykim/manguito-cms-cli test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /mnt/projects/manguito-cms
git add packages/cli/package.json pnpm-lock.yaml
git commit -m "fix(cli): align vite to v8 to match the admin package"
```

---

## Task 3: Changeset + installed-project end-to-end verification

**Files:**
- Create: `.changeset/admin-serving-installed-projects.md`

**Interfaces:**
- Consumes: the Task 1 admin package (source published, deps promoted) and the Task 2 CLI (vite 8).
- Produces: the release changeset and the acceptance proof.

- [ ] **Step 1: Write the changeset**

Create `.changeset/admin-serving-installed-projects.md`:
```markdown
---
"@bobbykim/manguito-cms-admin": minor
"@bobbykim/manguito-cms-cli": patch
---

Fix the admin panel failing (404 in `manguito dev`, unbuildable in `manguito build`) in installed projects. `dev`/`build` build the admin by running Vite against the admin package, but it previously shipped only `dist/`. The admin package now publishes its Vite source (`index.html`, `src/`, `public/`, `vite.config.ts`) and promotes its build toolchain (`vite`, `@vitejs/plugin-vue`, `@tailwindcss/vite`, `tailwindcss`) to dependencies, and the CLI is aligned to Vite 8 to match the admin. `dev`/`build`/`start` behavior is unchanged.
```

- [ ] **Step 2: Verify `changeset status`**

```bash
cd /mnt/projects/manguito-cms
pnpm changeset status
```
Expected: `@bobbykim/manguito-cms-admin` → minor, `@bobbykim/manguito-cms-cli` → patch.

- [ ] **Step 3: Build an installed-project fixture with the local admin + cli**

Scaffold a fresh project and override the admin/cli deps to the just-built local packages (everything else from the registry). This reproduces the exact installed-project scenario.
```bash
cd /mnt/projects/manguito-cms
# Pack the two changed packages (workspace:* is resolved to versions by pnpm pack)
ADMIN_TGZ=$(cd packages/admin && pnpm pack | tail -1 && cd - >/dev/null); ADMIN_TGZ="/mnt/projects/manguito-cms/packages/admin/$(ls packages/admin/bobbykim-manguito-cms-admin-*.tgz | xargs -n1 basename | tail -1)"
CLI_TGZ="/mnt/projects/manguito-cms/packages/cli/$(cd packages/cli && pnpm pack | tail -1 | xargs -n1 basename)"

WORK=$(mktemp -d); cd "$WORK"
# Scaffold with the published create-manguito (0.1.1 has the pnpm-usability fixes)
printf '' | npx -y @bobbykim/create-manguito@latest app <<'EOF'
app
Local filesystem
EOF
cd app
# Point admin + cli at the local tarballs; keep other deps from the registry
node -e "const fs=require('fs');const p=require('./package.json');p.pnpm={overrides:{'@bobbykim/manguito-cms-admin':'file:$ADMIN_TGZ','@bobbykim/manguito-cms-cli':'file:$CLI_TGZ'}};fs.writeFileSync('package.json',JSON.stringify(p,null,2))"
pnpm install --no-frozen-lockfile
echo "WORK=$WORK"
```
Expected: `pnpm install` completes; `node_modules/@bobbykim/manguito-cms-admin/index.html` exists (the published source is present in an installed project).

> Note: if `npx @bobbykim/create-manguito` cannot be driven non-interactively in this environment, scaffold instead by copying the published templates: `npm pack @bobbykim/create-manguito@latest`, extract, and copy `package/dist/templates/*` into `app/` renaming `*.template`→`*`, filling `{{projectName}}`=`app` and choosing the local storage factory. The rest of the step is identical.

- [ ] **Step 4: Verify `manguito build` produces the admin (the fix)**

`manguito build` does not touch the DB, so a dummy `DB_URL` is enough.
```bash
cd "$WORK/app"
cp .env.example .env
./node_modules/.bin/manguito build --env .env 2>&1 | tail -20
ls dist/admin/index.html && echo "INSTALLED-PROJECT ADMIN BUILD OK"
```
Expected: build reaches `✔ Admin panel compiled`, and `dist/admin/index.html` exists → the admin builds from the published source in a real installed project (the original bug is fixed). Clean up: `rm -f /mnt/projects/manguito-cms/packages/admin/bobbykim-*.tgz /mnt/projects/manguito-cms/packages/cli/bobbykim-*.tgz`.

- [ ] **Step 5 (optional, needs Postgres): Verify `manguito dev` serves `/admin`**

If a Postgres is available, this confirms the live-dev path too (dev connects to the DB before mounting Vite):
```bash
cd "$WORK/app"
# set DB_URL in .env to a reachable Postgres, then:
( ./node_modules/.bin/manguito dev --env .env & echo $! > /tmp/mdev.pid ; sleep 25 )
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin   # expect 200
kill "$(cat /tmp/mdev.pid)" 2>/dev/null
```
Expected: `200`. (Skip if no Postgres; Step 4 already proves the packaging fix, and `dev` uses the same Vite-from-source mechanism.)

- [ ] **Step 6: Commit**

```bash
cd /mnt/projects/manguito-cms
git add .changeset/admin-serving-installed-projects.md
git commit -m "chore(release): changeset for admin serving in installed projects"
```

---

## Self-Review

- **Spec coverage:** publish admin source (Task 1 Step 1) ✓; promote build deps (Task 1 Step 1) ✓; keep `dist` as library surface (files retains `dist`) ✓; drop monorepo `tsconfig.json` (Global Constraints + Task 1) ✓; align vite 8 (Task 2) ✓; no CLI serving-logic change (Global Constraints; Tasks touch only package.json) ✓; verification via real pnpm install + `manguito build` (Task 3) ✓; sandbox regression (Task 2 Step 4) ✓; changeset admin-minor/cli-patch (Task 3 Step 1) ✓.
- **Placeholder scan:** all values concrete (exact version specifiers, exact file lists, exact commands + expected output). No TBD/TODO.
- **Type/name consistency:** package names, version specifiers (`vite ^8.1.3`, `@vitejs/plugin-vue ^6.0.7`, `@tailwindcss/vite ^4.3.2`, `tailwindcss ^4.3.2`), and the `files` array are identical across Global Constraints and every task.
