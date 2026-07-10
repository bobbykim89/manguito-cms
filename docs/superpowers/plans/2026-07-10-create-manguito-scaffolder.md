# `@bobbykim/create-manguito` Scaffolder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract project scaffolding out of the CLI into a new lightweight `@bobbykim/create-manguito` package so `npm create @bobbykim/manguito my-app` is fast and self-contained, and remove `manguito init` from the CLI.

**Architecture:** A new workspace package `packages/create-manguito` owns the bin entry, the scaffold logic (moved from `packages/cli/src/commands/init.ts`), and the templates (moved from `packages/cli/src/templates`). Its single build-time dependency `@inquirer/prompts` is bundled into the output so the published package installs with no runtime dependencies. The CLI drops `init`, its templates, and the template-copy build step.

**Tech Stack:** TypeScript (Node ≥22, ESM), tsup (bundle + template copy), Vitest, Changesets, pnpm workspace + Turborepo.

## Global Constraints

- **New package name:** `@bobbykim/create-manguito`; bin name `create-manguito`; invoked as `npm create @bobbykim/manguito my-app` (npm inserts `create-`) or `npx @bobbykim/create-manguito my-app`.
- **Node:** `>=22.0.0`, `"type": "module"`, TypeScript strict (repo `tsconfig.base.json`).
- **Self-contained:** `@inquirer/prompts` is the only non-dev dependency and MUST be bundled (`noExternal`), leaving the published package with zero runtime `dependencies`.
- **Template copy MUST be idempotent** (fs remove-then-copy, never `cp -r`) — a `cp -r` into an existing/ turbo-cached `dist/templates` nests and shipped a broken scaffolder in 0.1.1.
- **Scaffolded output is unchanged** from today's `manguito init` (templates move verbatim, including the storage-adapter factory calls and `@types/node`/`tsconfig types` fixes).
- **v1 is scaffold-only:** prompt → write files → print next steps. No dependency install, no PM detection, no git init.
- **Breaking change:** removing `manguito init` makes the CLI a pre-1.0 breaking release → `@bobbykim/manguito-cms-cli` `0.2.0`.
- **Commits** follow commitizen conventional-commits (`type(scope): subject`).
- **Sequencing:** lands after the 0.1.2 CLI hotfix (PR #17). Before implementing, rebase this branch onto the post-0.1.2 `master`.

---

## File Structure

New package `packages/create-manguito/`:

- `package.json` — name, bin, `@inquirer/prompts` (dev, bundled), metadata, `version: 0.1.0`.
- `tsconfig.json` — extends repo base; `types: ["node"]`.
- `vitest.config.ts` — `globals: true`.
- `tsup.config.ts` — bundle, `noExternal: ['@inquirer/prompts']`, idempotent template copy.
- `src/index.ts` — bin entry (shebang): parse `[name]`, build prompt adapter, call `scaffold`.
- `src/prompt.ts` — `PromptAdapter` interface + `createPromptAdapter` (trimmed to `input`/`select`).
- `src/scaffold.ts` — `scaffold()`, `STORAGE_ADAPTERS`, `renderTemplate`, `walkTemplates`, local console helpers.
- `src/templates/**` — moved verbatim from the CLI.
- `tests/scaffold.test.ts` — ported from the CLI's `init.test.ts`.

CLI edits (`packages/cli/`): delete `src/commands/init.ts`, `src/templates/`, `tests/init.test.ts`; remove `registerInit` from `src/index.ts`; remove the template-copy `onSuccess` from `tsup.config.ts`.

Docs: root `README.md` (Quick Start, CLI Reference, Packages table), `RELEASE.md` (published-packages list). Changeset for the CLI `0.2.0`.

---

## Task 1: Create the `@bobbykim/create-manguito` package

**Files:**
- Create: `packages/create-manguito/package.json`
- Create: `packages/create-manguito/tsconfig.json`
- Create: `packages/create-manguito/vitest.config.ts`
- Create: `packages/create-manguito/tsup.config.ts`
- Create: `packages/create-manguito/src/prompt.ts`
- Create: `packages/create-manguito/src/scaffold.ts`
- Create: `packages/create-manguito/src/index.ts`
- Create: `packages/create-manguito/src/templates/**` (copied from `packages/cli/src/templates/**`)
- Test: `packages/create-manguito/tests/scaffold.test.ts`

**Interfaces:**
- Produces: `scaffold(name: string | undefined, deps: { prompt: PromptAdapter; targetDir?: string }): Promise<void>` and `interface PromptAdapter { input(message: string, defaultValue?: string): Promise<string>; select(message: string, choices: string[]): Promise<string> }`, both in `src/`. Consumed by `src/index.ts` and the tests.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@bobbykim/create-manguito",
  "version": "0.1.0",
  "license": "MIT",
  "author": "Bobby Kim <bobby.sihun.kim@gmail.com>",
  "homepage": "https://github.com/bobbykim89/manguito-cms",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/bobbykim89/manguito-cms.git",
    "directory": "packages/create-manguito"
  },
  "type": "module",
  "bin": {
    "create-manguito": "./dist/index.js"
  },
  "files": [
    "dist"
  ],
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "devDependencies": {
    "@inquirer/prompts": "^7.10.1",
    "@types/node": "^25.9.5",
    "tsup": "^8.5.1",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
}
```

(`@inquirer/prompts` is a devDependency because it is bundled into `dist` — the published package has no runtime `dependencies`.)

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
})
```

- [ ] **Step 4: Create `tsup.config.ts`**

```ts
import { cpSync, rmSync } from 'node:fs'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  dts: false,
  clean: true,
  bundle: true,
  // Bundle the prompt library so the published package installs with no deps.
  noExternal: ['@inquirer/prompts'],
  // Bundled CJS deps use esbuild's __require shim; inject createRequire so it works.
  banner: {
    js: "import { createRequire as __cjsRequire } from 'module';\nconst require = __cjsRequire(import.meta.url);",
  },
  // Copy templates next to the bundle. Must be idempotent — `cp -r` nests into
  // dist/templates/templates when the target already exists (turbo-cached dist).
  onSuccess: async () => {
    rmSync('dist/templates', { recursive: true, force: true })
    cpSync('src/templates', 'dist/templates', { recursive: true })
  },
})
```

- [ ] **Step 5: Copy the templates from the CLI**

Run:
```bash
cd /mnt/projects/manguito-cms
mkdir -p packages/create-manguito/src
cp -r packages/cli/src/templates packages/create-manguito/src/templates
find packages/create-manguito/src/templates -type f | sort
```
Expected: the full template set (`.env.example.template`, `.gitignore.template`, `manguito.config.ts.template`, `package.json.template`, `README.md.template`, `tsconfig.json.template`, and `schemas/**`). The CLI's copy stays in place for now (removed in Task 2), so the CLI keeps working.

- [ ] **Step 6: Create `src/prompt.ts`**

```ts
import { input, select } from '@inquirer/prompts'

export interface PromptAdapter {
  input(message: string, defaultValue?: string): Promise<string>
  select(message: string, choices: string[]): Promise<string>
}

export function createPromptAdapter(): PromptAdapter {
  return {
    input: (message, defaultValue) =>
      input({ message, ...(defaultValue !== undefined ? { default: defaultValue } : {}) }),

    select: (message, choices) =>
      select({
        message,
        choices: choices.map((c) => ({ value: c, name: c })),
      }),
  }
}
```

- [ ] **Step 7: Write the failing test `tests/scaffold.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PromptAdapter } from '../src/prompt.js'

import { scaffold } from '../src/scaffold.js'

function makePrompt(projectName = 'test-project', adapterChoice = 'Local filesystem'): PromptAdapter {
  return {
    input: vi.fn().mockResolvedValue(projectName),
    select: vi.fn().mockResolvedValue(adapterChoice),
  }
}

describe('scaffold', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'create-manguito-test-'))
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('aborts with a guided error and writes nothing when the target dir is non-empty', async () => {
    writeFileSync(join(tempDir, 'existing-file.txt'), 'content')

    await scaffold(undefined, { prompt: makePrompt(), targetDir: tempDir })

    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('not empty'))
    expect(readdirSync(tempDir)).toEqual(['existing-file.txt'])
  })

  it('writes all expected scaffold files to targetDir', async () => {
    await scaffold('my-project', { prompt: makePrompt('my-project'), targetDir: tempDir })

    const projectDir = join(tempDir, 'my-project')
    const expectedFiles = [
      'manguito.config.ts',
      'package.json',
      'tsconfig.json',
      '.gitignore',
      '.env.example',
      'README.md',
      'schemas/roles.json',
      'schemas/routes.json',
      'schemas/content-types/blog-post.json',
      'schemas/taxonomy-types/tag.json',
      'schemas/paragraph-types/.gitkeep',
    ]
    for (const file of expectedFiles) {
      expect(existsSync(join(projectDir, file)), `expected ${file} to exist`).toBe(true)
    }
  })

  it('substitutes projectName into rendered config', async () => {
    await scaffold('acme-blog', { prompt: makePrompt('acme-blog', 'Amazon S3'), targetDir: tempDir })
    const config = readFileSync(join(tempDir, 'acme-blog', 'manguito.config.ts'), 'utf8')
    expect(config).toContain("name: 'acme-blog'")
  })

  it('scaffolds @types/node so the config typechecks (process.env)', async () => {
    await scaffold('types-test', { prompt: makePrompt('types-test'), targetDir: tempDir })
    const pkg = JSON.parse(
      readFileSync(join(tempDir, 'types-test', 'package.json'), 'utf8')
    ) as { devDependencies?: Record<string, string> }
    expect(pkg.devDependencies?.['@types/node']).toBeDefined()
  })

  it('leaves no unrendered {{placeholders}} in scaffold output', async () => {
    await scaffold('ph-test', { prompt: makePrompt('ph-test', 'Cloudinary'), targetDir: tempDir })
    const projectDir = join(tempDir, 'ph-test')
    for (const file of ['manguito.config.ts', '.env.example']) {
      const content = readFileSync(join(projectDir, file), 'utf8')
      expect(content, `${file} still has a placeholder`).not.toMatch(/\{\{\w+\}\}/)
    }
  })

  it.each([
    { choice: 'Local filesystem', factory: 'createLocalAdapter(', others: ['createS3Adapter', 'createCloudinaryAdapter'], envVar: 'STORAGE_LOCAL_UPLOAD_DIR' },
    { choice: 'Amazon S3', factory: 'createS3Adapter(', others: ['createLocalAdapter', 'createCloudinaryAdapter'], envVar: 'STORAGE_S3_BUCKET' },
    { choice: 'Cloudinary', factory: 'createCloudinaryAdapter(', others: ['createLocalAdapter', 'createS3Adapter'], envVar: 'CLOUDINARY_CLOUD_NAME' },
  ])('wires a real $factory call and matching env vars for $choice', async ({ choice, factory, others, envVar }) => {
    await scaffold('store-test', { prompt: makePrompt('store-test', choice), targetDir: tempDir })

    const projectDir = join(tempDir, 'store-test')
    const config = readFileSync(join(projectDir, 'manguito.config.ts'), 'utf8')
    const env = readFileSync(join(projectDir, '.env.example'), 'utf8')

    expect(config).toContain(`storage: ${factory}`)
    expect(config).toContain(`import { ${factory.replace('(', '')} }`)
    for (const other of others) {
      expect(config, `${other} should not be imported`).not.toContain(other)
    }
    expect(env).toContain(envVar)
  })
})
```

- [ ] **Step 8: Run the test to verify it fails**

Run:
```bash
cd /mnt/projects/manguito-cms && pnpm install
pnpm --filter @bobbykim/create-manguito exec vitest run tests/scaffold.test.ts
```
Expected: FAIL — cannot resolve `../src/scaffold.js` (not created yet).

- [ ] **Step 9: Create `src/scaffold.ts`**

```ts
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PromptAdapter } from './prompt.js'

// scaffold.ts lives at the package root of src/, so the templates sit beside it
// at src/templates in source and dist/templates in the tsup bundle.
const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates')

function printGuidedError(message: string, hint?: string): void {
  process.stderr.write(`✖ ${message}\n`)
  if (hint !== undefined) {
    process.stderr.write(`  ${hint}\n`)
  }
}

function printSuccess(message: string): void {
  process.stdout.write(`✔ ${message}\n`)
}

export function renderTemplate(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
}

// Per-adapter scaffold substitutions. Each choice supplies the import line, the
// `storage:` factory call, and the .env.example variables — kept together so the
// generated config, its import, and its env stay in sync. Note: with the
// scaffold tsconfig's noUncheckedIndexedAccess, S3's required bucket/region must
// use `!`, while Cloudinary/local options are optional and don't.
type StorageTemplate = { import: string; factory: string; env: string }

const STORAGE_ADAPTERS: Record<string, StorageTemplate> = {
  'Local filesystem': {
    import: `import { createLocalAdapter } from '@bobbykim/manguito-cms-api/storage'`,
    factory: `createLocalAdapter({ upload_dir: process.env['STORAGE_LOCAL_UPLOAD_DIR'] })`,
    env: `# Local filesystem storage (files persist under this directory; defaults to ./uploads)\n# STORAGE_LOCAL_UPLOAD_DIR=./uploads`,
  },
  'Amazon S3': {
    import: `import { createS3Adapter } from '@bobbykim/manguito-cms-api/storage'`,
    factory: `createS3Adapter({\n    bucket: process.env['STORAGE_S3_BUCKET']!,\n    region: process.env['STORAGE_S3_REGION']!,\n  })`,
    env: `STORAGE_S3_BUCKET=\nSTORAGE_S3_REGION=`,
  },
  Cloudinary: {
    import: `import { createCloudinaryAdapter } from '@bobbykim/manguito-cms-api/storage'`,
    factory: `createCloudinaryAdapter({\n    cloud_name: process.env['CLOUDINARY_CLOUD_NAME'],\n    access_key_id: process.env['CLOUDINARY_API_KEY'],\n    secret_access_key: process.env['CLOUDINARY_API_SECRET'],\n  })`,
    env: `CLOUDINARY_CLOUD_NAME=\nCLOUDINARY_API_KEY=\nCLOUDINARY_API_SECRET=`,
  },
}

export async function scaffold(
  name: string | undefined,
  deps: { prompt: PromptAdapter; targetDir?: string }
): Promise<void> {
  const cwd = deps.targetDir ?? process.cwd()
  const usesCwd = name === undefined || name === '.'
  const targetDir = usesCwd ? cwd : join(cwd, name!)
  const displayName = usesCwd ? '.' : name!

  if (existsSync(targetDir)) {
    const entries = readdirSync(targetDir)
    if (entries.length > 0) {
      printGuidedError(
        `Directory "${displayName}" already exists and is not empty.`,
        'Choose a different name, or run `npm create @bobbykim/manguito` inside an empty directory.'
      )
      return
    }
  }

  process.stdout.write('Manguito CMS — New Project\n\n')

  const projectName = await deps.prompt.input('Project name:', name)

  const adapterChoice = await deps.prompt.select('Storage adapter:', [
    'Local filesystem',
    'Amazon S3',
    'Cloudinary',
  ])

  const storage = STORAGE_ADAPTERS[adapterChoice] ?? STORAGE_ADAPTERS['Local filesystem']!

  const vars = {
    projectName,
    storageImport: storage.import,
    storageAdapter: storage.factory,
    storageEnv: storage.env,
  }
  const templateFiles = walkTemplates(TEMPLATES_DIR)

  for (const templatePath of templateFiles) {
    const relPath = relative(TEMPLATES_DIR, templatePath)
    const outputRelPath = relPath.replace(/\.template$/, '')
    const outputPath = join(targetDir, outputRelPath)

    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, renderTemplate(readFileSync(templatePath, 'utf8'), vars), 'utf8')
  }

  // paragraph-types has no template files — create the dir with a .gitkeep
  const paragraphTypesDir = join(targetDir, 'schemas', 'paragraph-types')
  mkdirSync(paragraphTypesDir, { recursive: true })
  writeFileSync(join(paragraphTypesDir, '.gitkeep'), '', 'utf8')

  printSuccess('Project scaffolded.')

  process.stdout.write('\nNext steps:\n')
  if (!usesCwd) {
    process.stdout.write(`  cd ${name}\n`)
  }
  process.stdout.write('  cp .env.example .env\n')
  process.stdout.write('  # Fill in DB_URL and AUTH_SECRET in .env\n')
  process.stdout.write('  pnpm install\n')
  process.stdout.write('  pnpm dev\n')
}

function walkTemplates(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkTemplates(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run:
```bash
cd /mnt/projects/manguito-cms
pnpm --filter @bobbykim/create-manguito exec vitest run tests/scaffold.test.ts
```
Expected: PASS (all cases, output pristine).

- [ ] **Step 11: Create `src/index.ts` (the bin)**

```ts
#!/usr/bin/env node
import { scaffold } from './scaffold.js'
import { createPromptAdapter } from './prompt.js'

const name = process.argv[2]

scaffold(name, { prompt: createPromptAdapter() }).catch((err: unknown) => {
  process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
```

- [ ] **Step 12: Build and verify the bundle is self-contained with flat templates**

Run:
```bash
cd /mnt/projects/manguito-cms
pnpm --filter @bobbykim/create-manguito build
# templates are a flat mirror of source (no nesting)
diff <(cd packages/create-manguito/dist/templates && find . | sort) <(cd packages/create-manguito/src/templates && find . | sort) && echo "TEMPLATES FLAT ✓"
# @inquirer is bundled, not required at runtime
grep -c "require('@inquirer" packages/create-manguito/dist/index.js || echo "no external @inquirer require ✓"
```
Expected: `TEMPLATES FLAT ✓`, and no runtime `require('@inquirer...')` in the bundle. If tsup fails to bundle `@inquirer/prompts`, fall back to declaring it a normal `dependency` (remove it from `noExternal`) — still a light install — and note it in the report.

- [ ] **Step 13: Verify a clean install pulls no runtime deps (self-contained)**

Run:
```bash
cd /mnt/projects/manguito-cms/packages/create-manguito
TGZ=$(pnpm pack | tail -1)
D=$(mktemp -d); cd "$D"; echo '{"name":"cr","private":true}' > package.json
npm install "/mnt/projects/manguito-cms/packages/create-manguito/$TGZ" --no-audit --no-fund
ls node_modules | grep -v '^\.' | grep -v '^@bobbykim$' || echo "no third-party runtime deps ✓"
ls node_modules/@bobbykim 2>/dev/null
cd /mnt/projects/manguito-cms/packages/create-manguito && rm -f "$TGZ"
```
Expected: only `@bobbykim/create-manguito` is installed (its `@inquirer` is bundled), confirming a single-package install. Clean up the tarball.

- [ ] **Step 14: Commit**

```bash
cd /mnt/projects/manguito-cms
git add packages/create-manguito
git commit -m "feat(create-manguito): add lightweight scaffolder package"
```

---

## Task 2: Remove `init` from the CLI

**Files:**
- Delete: `packages/cli/src/commands/init.ts`
- Delete: `packages/cli/src/templates/` (whole directory)
- Delete: `packages/cli/tests/init.test.ts`
- Modify: `packages/cli/src/index.ts` (remove `registerInit` import + call)
- Modify: `packages/cli/tsup.config.ts` (remove the template-copy `onSuccess`)

**Interfaces:**
- Consumes: nothing from Task 1 at build time (the CLI no longer scaffolds). The scaffolded `package.json.template` (now owned by `create-manguito`) still lists `@bobbykim/manguito-cms-cli` as a devDependency, so the CLI remains the in-project tool.

- [ ] **Step 1: Delete the init command, templates, and its test**

Run:
```bash
cd /mnt/projects/manguito-cms
git rm packages/cli/src/commands/init.ts packages/cli/tests/init.test.ts
git rm -r packages/cli/src/templates
```

- [ ] **Step 2: Remove `registerInit` from `packages/cli/src/index.ts`**

Delete the import line `import { registerInit } from './commands/init.js'` and the `registerInit(program)` call. The remaining registrations stay: `registerBuild`, `registerDev`, `registerStart`, `registerMigrate`, `registerValidate`, `registerCreateSuperuser`, `registerUsers`.

- [ ] **Step 3: Remove the template-copy step from `packages/cli/tsup.config.ts`**

Delete the `onSuccess` line that copies templates (`onSuccess: 'cp -r src/templates dist/templates'`, or the fs remove-then-copy variant introduced by the 0.1.2 hotfix). The CLI ships no templates now. Also remove the `import { cpSync, rmSync } from 'node:fs'` line if the hotfix added it and nothing else uses it.

- [ ] **Step 4: Verify the CLI builds and tests pass without init**

Run:
```bash
cd /mnt/projects/manguito-cms
grep -rn "registerInit\|src/templates\|commands/init" packages/cli/src packages/cli/tests && echo "STRAY REFERENCES (fix)" || echo "no stray init references ✓"
pnpm --filter @bobbykim/manguito-cms-cli build
pnpm --filter @bobbykim/manguito-cms-cli test
node packages/cli/dist/index.js --help | grep -q "init" && echo "init STILL PRESENT (fix)" || echo "init removed ✓"
```
Expected: no stray references; build succeeds; the CLI test suite passes (the `init.test.ts` cases are gone, the rest remain green); `--help` no longer lists `init`.

- [ ] **Step 5: Commit**

```bash
cd /mnt/projects/manguito-cms
git add -A packages/cli
git commit -m "feat(cli)!: remove init; scaffolding moves to @bobbykim/create-manguito"
```

---

## Task 3: Docs and changeset

**Files:**
- Modify: `README.md` (Quick Start, CLI Reference, Packages table)
- Modify: `RELEASE.md` (published-packages list)
- Create: `.changeset/cli-remove-init.md`

**Interfaces:**
- Consumes: the package name and command from Task 1 (`@bobbykim/create-manguito`, `npm create @bobbykim/manguito`).

- [ ] **Step 1: Update the root `README.md`**

- **Quick Start:** replace the scaffold command `npx @bobbykim/manguito-cms-cli init my-cms` with:
  ```bash
  npm create @bobbykim/manguito my-app
  ```
  (Search the whole file for `init` — also fix the `manguito init` reference in the **Approach** section's example.)
- **CLI Reference:** remove the `manguito init [name]` row from the command table. The remaining 9 commands stay.
- **Packages table:** add a row:
  ```
  | `create-manguito`    | `@bobbykim/create-manguito`    | `npm create @bobbykim/manguito` project scaffolder |
  ```

- [ ] **Step 2: Update `RELEASE.md`**

Add `@bobbykim/create-manguito` to the published-packages list (the five-package bullet list becomes six). No other steps change.

- [ ] **Step 3: Verify no stale scaffold instructions remain**

Run:
```bash
cd /mnt/projects/manguito-cms
grep -rn "manguito-cms-cli init\|manguito init" README.md RELEASE.md docs/*.md && echo "STALE init INSTRUCTIONS (fix)" || echo "docs updated ✓"
```
Expected: no remaining `manguito init` scaffold instructions in user docs. (Design/spec/plan files under `docs/superpowers/` are historical and may mention it.)

- [ ] **Step 4: Create the CLI changeset**

Create `.changeset/cli-remove-init.md`:
```markdown
---
"@bobbykim/manguito-cms-cli": minor
---

Remove the `manguito init` command. Project scaffolding now lives in the dedicated `@bobbykim/create-manguito` package — run `npm create @bobbykim/manguito my-app`. This is a breaking change to the CLI (the `init` command no longer exists).
```

(No changeset is added for `@bobbykim/create-manguito`: it is a new package at `0.1.0` not yet on npm, so `changeset publish` will publish it as `0.1.0` on the next release.)

- [ ] **Step 5: Verify the release plan**

Run:
```bash
cd /mnt/projects/manguito-cms
pnpm changeset status 2>&1 | grep -A6 "bumped"
```
Expected: `@bobbykim/manguito-cms-cli` bumped at **minor** (→ 0.2.0). `@bobbykim/create-manguito` is not listed as "bumped" (it publishes at its existing 0.1.0).

- [ ] **Step 6: Commit**

```bash
cd /mnt/projects/manguito-cms
git add README.md RELEASE.md .changeset/cli-remove-init.md
git commit -m "docs: switch scaffold instructions to npm create @bobbykim/manguito; changeset"
```

---

## Self-Review

- **Spec coverage:** New package (Task 1) ✓; bundled `@inquirer`, self-contained (Task 1 steps 4/12/13) ✓; templates moved + idempotent copy (Task 1 steps 4/5/12) ✓; scaffold-only behavior identical output (Task 1 `src/scaffold.ts`, tests) ✓; CLI drops `init`/templates/test/tsup-copy → 0.2.0 (Task 2, Task 3 changeset) ✓; docs (Task 3) ✓; testing ported with same coverage + flat-dist check (Task 1 steps 7/12) ✓; versioning create 0.1.0 / cli 0.2.0 (Task 1 package.json, Task 3 changeset) ✓.
- **Placeholder scan:** All file contents are concrete; verification commands have expected output. The only `# ...` are legitimate shell comments.
- **Type consistency:** `PromptAdapter` (input/select) is defined in `src/prompt.ts` and consumed identically by `src/scaffold.ts`, `src/index.ts`, and the test mock. `scaffold(name, { prompt, targetDir })` signature matches across the test, `src/index.ts`, and its definition.
- **Note:** the scaffolder's printed next-steps are corrected to `pnpm dev` and mention `AUTH_SECRET` (the old `init` printed `manguito dev` / only `DB_URL`); the generated project *files* are byte-for-byte identical to today's `init` output, which is what the acceptance criteria require.
