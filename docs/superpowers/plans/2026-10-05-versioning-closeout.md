# Schema Versioning Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the schema versioning arc. That means renaming `version:cut` to `version:create`, adding `version:list`, making `manguito validate` reject what `manguito build` rejects, and documenting the feature.

**Architecture:** One CLI helper, `loadProjectVersionModel`, becomes the only way any command computes the version model, so `validate`, `build`, `dev` and the `version:*` commands cannot disagree. `version:create` is today's `version:cut` handler with honest messages; `version:cut` survives as a hidden alias. `version:list` composes core's existing `describeSchemaChange` with a pure formatter. The rest is documentation and decision records.

**Tech Stack:** TypeScript strict (Node 22+), commander, Vitest, pnpm workspace + Changesets.

**Spec:** `docs/superpowers/specs/2026-10-05-versioning-closeout-design.md`. Read it before Task 1.

## Global Constraints

- **Never commit to `master`.** This plan runs on branch `feat/versioning-closeout`.
- **Commit format:** conventional commits `type(scope): subject`; scope is the package (`cli`, `create-manguito`) or `docs`. End every commit with the `Co-Authored-By` trailer your harness instructs.
- **No core, api or db source changes.** If a task finds itself editing `packages/core/src`, `packages/api/src` or `packages/db/src`, stop and report.
- **`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on** (`tsconfig.base.json`). Optional properties may be absent, never present-and-undefined.
- **Import extensions:** source under `packages/cli/src/` uses `.js` in relative imports, including its `__tests__`; `packages/cli/tests/` also imports `../src/...js`.
- **`packages/cli/tests/` is not typechecked or linted** (`tsconfig.json` includes only `src`; `lint` is `eslint src`). Keep it type-correct anyway, and put pure-function tests in `src/__tests__/`.
- **The CLI's error printer does not print error codes.** `printValidationErrors` prints each error's `file` and `message` only. A test proves which version error fired by asserting on a fragment of core's message, never on the code string.
- **Every new test states the mutation it rejects, and each is verified** (PLAN-QUALITY rule 1): apply it, watch the test fail, restore, watch it pass.
- **Gates for every task:** `pnpm --filter @bobbykim/manguito-cms-cli test`, `pnpm --filter @bobbykim/manguito-cms-cli typecheck`, `pnpm --filter @bobbykim/manguito-cms-cli lint`, and `pnpm build`. Docs tasks also run `pnpm lint:plans` on every Markdown file they create or edit, which checks that relative links resolve.
- **Measured baseline at the branch point (`db7a7bd`, 2026-10-05):** cli `20 files, 100 passed`; create-manguito `1 file, 10 passed`. Totals later in this plan are indicative; trust each task's stated delta.

## Review Focus

Five inputs the spec implies but does not spell out as a test. Each is pinned in the task that owns its code.

1. **A snapshot directory that does not parse** (a hand-edited or half-copied `versions/v1/`) must make `validate` fail and name the snapshot. Today it passes. → **Task 1**
2. **`version:cut --yes`** must forward `--yes` to `version:create`. A dropped option would turn an unattended CI step into one that blocks on a prompt forever. → **Task 2**
3. **Running `version:create` twice with no change in between** must refuse with the new wording and write nothing. → **Task 2**
4. **A live set with a gap** (v2 retired, v1 and v3 still live) must list v1 and v3 only, and still compute each one's drift. → **Task 3**
5. **A content type added after a version was created** must count its fields as "added" for that version, not be ignored. → **Task 3**

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/cli/src/utils/project-version-model.ts` | **new**: `loadProjectVersionModel`, the single composition of `loadVersionSnapshots` + `computeVersionModel` | 1 |
| `packages/cli/src/commands/validate.ts` | runs the version check after cross-references; prints the live set on success | 1 |
| `packages/cli/src/commands/build.ts` | runs the version check before any codegen write | 1 |
| `packages/cli/src/commands/dev.ts` | uses the helper at startup and on reload; points failures at `manguito validate` | 1 |
| `packages/cli/src/commands/version.ts` | the helper in `loadVersionContext`; `version:create` and the alias (2); `version:list` (3) | 1, 2, 3 |
| `packages/cli/src/commands/version-report.ts` | first-run header wording (2); `formatVersionList` (3) | 2, 3 |
| `packages/cli/tests/support/temp-project.ts` | **new**: a real project on disk plus a handler runner, shared by the real-core tests | 1 |
| `packages/cli/tests/validate-versions.test.ts` | **new**: `validate` and `build` against real core and a real temp project | 1 |
| `packages/cli/tests/version-create.test.ts` | **new**: `version:create`, the alias, and retire's renamed messages | 2 |
| `packages/cli/tests/version-list.test.ts` | **new**: `version:list` end to end | 3 |
| `.changeset/version-create-and-list.md` | **new**: cli minor | 3 |
| `docs/schema-versioning.md` | **new**: the user guide | 4 |
| `docs/schema-authoring.md`, `docs/graphql.md`, `README.md` | link into the guide, document `column`/`removed`/`fallback` | 4 |
| `packages/create-manguito/src/templates/README.md.template` | the `version:*` commands and `schemas/versions/` | 4 |
| `.changeset/create-manguito-versioning-readme.md` | **new**: create-manguito patch | 4 |
| `docs/v2/schema-versioning.md` | **new**: the design index | 5 |
| `docs/adr/api/0012-multi-version-public-api.md`, `docs/adr/core/0007-column-is-cross-version-identity.md` | **new** ADRs | 5 |
| `docs/adr/api/0011-field-label-vs-storage-key.md` | corrected for 2f | 5 |
| `packages/core/CONTEXT.md`, `packages/api/CONTEXT.md`, `packages/cli/CONTEXT.md` | glossary | 5 |

---

### Task 1: One shared version check; `validate` uses it

`manguito validate` never computes the version model, so it reports "No errors found" on schemas `build` rejects. A probe on 2026-10-05 confirmed it for a leftover tombstone and for a type change while v1 is live; in both cases `version:diff` exits 1. `build` also writes into `dist/generated` before it checks, so a failed build leaves partial output.

**Files:**
- Create: `packages/cli/src/utils/project-version-model.ts`
- Create: `packages/cli/tests/support/temp-project.ts`
- Modify: `packages/cli/src/commands/validate.ts` — `runValidate`
- Modify: `packages/cli/src/commands/build.ts` — `runBuild`
- Modify: `packages/cli/src/commands/dev.ts` — the startup version-model block and the one in the reload handler
- Modify: `packages/cli/src/commands/version.ts` — `loadVersionContext`
- Modify: `packages/cli/tests/validate.test.ts` — its core mock gains the two version functions
- Test: `packages/cli/tests/validate-versions.test.ts` (new), `packages/cli/tests/dev.test.ts`

**Interfaces:**
- Produces: `loadProjectVersionModel(schema: ResolvedSchemaConfig, registry: SchemaRegistry): Result<{ snapshots: VersionSnapshot[]; model: VersionModel }>`, exported from `packages/cli/src/utils/project-version-model.ts`. `Result` is core's exported type: `{ ok: true; value: T } | { ok: false; errors: ParseError[] }`.
- Produces: `VersionContext` in `version.ts` gains `apiPrefix: string`, which is `config.api.prefix ?? '/api'`. Tasks 2 and 3 read it.
- Produces: `packages/cli/tests/support/temp-project.ts` exporting `makeTempProject()`, `run()`, `snapshot()` and the types `TempProject` and `Run`, exactly as written in Step 1. Tasks 2 and 3 import them.

- [ ] **Step 1: Create the shared test support**

Create `packages/cli/tests/support/temp-project.ts`. It builds a project on disk the way `create-manguito` scaffolds one: the four schema folders, plus the scaffolder's own `roles.json` and `routes.json` templates. **Fixture invariant (PLAN-QUALITY rule 4):** the parser requires all four folders to exist, even when empty. `snapshot()` calls the real producer, `writeSnapshotAtomically`, so a snapshot here is exactly what `version:create` writes: the four schema-type folders copied under `versions/vN/`, with `roles.json` and `routes.json` excluded.

```typescript
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'
import { writeSnapshotAtomically } from '../../src/commands/version-fs.js'

// The scaffolder's own roles.json and routes.json: real, valid files, kept in
// step with what `create-manguito` ships rather than hand-written here.
const TEMPLATES = path.resolve(__dirname, '../../../create-manguito/src/templates/schemas')

/** `config.schema.folders` as `defineConfig` defaults it. */
export const FOLDERS = {
  content_types: 'content-types',
  paragraph_types: 'paragraph-types',
  taxonomy_types: 'taxonomy-types',
  enum_types: 'enum-types',
}

export type TempProject = {
  root: string
  /** Absolute `schema.base_path`. */
  schemas: string
  /** Writes `content-types/<name>.json` with one tab holding `fields`. */
  writeType(name: string, fields: object[], basePath?: string): void
  cleanup(): void
}

export function makeTempProject(): TempProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manguito-cli-'))
  const schemas = path.join(root, 'schemas')
  // The parser rejects a project missing any of the four folders, even empty.
  for (const folder of Object.values(FOLDERS)) {
    fs.mkdirSync(path.join(schemas, folder), { recursive: true })
  }
  fs.copyFileSync(path.join(TEMPLATES, 'roles.json.template'), path.join(schemas, 'roles.json'))
  fs.copyFileSync(path.join(TEMPLATES, 'routes.json.template'), path.join(schemas, 'routes.json'))

  return {
    root,
    schemas,
    writeType(name, fields, basePath = 'posts') {
      fs.writeFileSync(
        path.join(schemas, FOLDERS.content_types, `${name}.json`),
        JSON.stringify({
          name,
          label: name,
          type: 'content-type',
          default_base_path: basePath,
          only_one: false,
          fields: [{ tab: { name: 'main', label: 'Main', fields } }],
        })
      )
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

/** Freezes the project's current schema folders as `version`, via the real writer. */
export function snapshot(project: TempProject, version: string): void {
  writeSnapshotAtomically({
    fromRoot: project.schemas,
    versionsDir: path.join(project.schemas, 'versions'),
    version,
    folders: FOLDERS,
  })
}

export type Run = { exitCode: number | null; stdout: string; stderr: string }

class ExitSignal extends Error {}

/**
 * Runs a command handler, capturing stdout, stderr and any process.exit.
 * `process.exit` is turned into a thrown signal so the handler stops exactly
 * where the real process would, and the code is recorded rather than lost.
 */
export async function run(fn: () => Promise<void>): Promise<Run> {
  let stdout = ''
  let stderr = ''
  let exitCode: number | null = null
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk)
    return true
  })
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0
    throw new ExitSignal()
  }) as never)
  try {
    await fn()
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e
  } finally {
    out.mockRestore()
    err.mockRestore()
    exit.mockRestore()
  }
  return { exitCode, stdout, stderr }
}
```

Before writing anything else, confirm the call `writeSnapshotAtomically({ fromRoot, versionsDir, version, folders })` matches the function's real signature: `grep -n "export function writeSnapshotAtomically" -A6 packages/cli/src/commands/version-fs.ts`. If it differs, adapt `snapshot()` to the real signature and say so in your report.

- [ ] **Step 2: Write the failing real-core tests**

Create `packages/cli/tests/validate-versions.test.ts`. Only env loading and config loading are mocked. Core, the parser, the filesystem and the version model are all real.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { makeTempProject, run, snapshot, type TempProject } from './support/temp-project.js'

let project: TempProject

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))
vi.mock('../src/utils/config.js', () => ({
  // Read lazily: `project` is assigned in beforeEach, after this factory runs.
  resolveConfig: vi.fn(async () => ({
    schema: {
      base_path: project.schemas,
      folders: {
        content_types: 'content-types',
        paragraph_types: 'paragraph-types',
        taxonomy_types: 'taxonomy-types',
        enum_types: 'enum-types',
      },
    },
    api: { prefix: '/api', media: undefined },
    programmatic: { dir: './src/programmatic' },
  })),
}))

import { runValidate } from '../src/commands/validate.js'
import { runBuild } from '../src/commands/build.js'

const title = { name: 'title', label: 'Title', type: 'text/plain', required: false }

// Fragments of core's own messages. The CLI prints messages, not codes.
const ORPHANED = 'no live version exposes that column any more'
const TYPE_CHANGED = 'is exposed by live version v1 as text/plain, but the current schema now types it integer'

beforeEach(() => {
  project = makeTempProject()
})
afterEach(() => {
  project.cleanup()
})

describe('manguito validate — version model', () => {
  it('rejects a tombstone no live version exposes (ORPHANED_TOMBSTONE)', async () => {
    // The case version:retire tells the author validate will report.
    // MUTATION: drop the loadProjectVersionModel call from runValidate.
    // validate then prints "No errors found" and exits normally.
    project.writeType('content--blog_post', [
      title,
      { name: 'legacy', column: 'legacy_col', label: 'Legacy', type: 'text/plain', required: false, removed: true },
    ])

    const result = await run(() => runValidate({}, { cwd: project.root }))

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(ORPHANED)
  })

  it('rejects a type change while a version is live (FIELD_TYPE_CHANGED_WHILE_LIVE)', async () => {
    // MUTATION: drop the loadProjectVersionModel call from runValidate.
    project.writeType('content--blog_post', [title])
    snapshot(project, 'v1')
    project.writeType('content--blog_post', [{ ...title, type: 'integer' }])

    const result = await run(() => runValidate({}, { cwd: project.root }))

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(TYPE_CHANGED)
  })

  it('names a snapshot that does not parse (VERSION_SNAPSHOT_INVALID)', async () => {
    // Review Focus #1: a hand-edited or half-copied snapshot.
    // MUTATION: drop the loadProjectVersionModel call from runValidate.
    project.writeType('content--blog_post', [title])
    snapshot(project, 'v1')
    fs.writeFileSync(
      path.join(project.schemas, 'versions', 'v1', 'content-types', 'content--blog_post.json'),
      '{ not json'
    )

    const result = await run(() => runValidate({}, { cwd: project.root }))

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(path.join('versions', 'v1'))
  })

  it('passes a valid versioned project and reports the live set', async () => {
    // A declared rename while v1 is live is exactly what versioning is for.
    // MUTATION: in runValidate, pass an empty registry to the helper. The
    // model then reports v1's column as missing (VERSION_COLUMN_MISSING).
    project.writeType('content--blog_post', [title])
    snapshot(project, 'v1')
    project.writeType('content--blog_post', [{ ...title, name: 'heading', column: 'title' }])

    const result = await run(() => runValidate({}, { cwd: project.root }))

    expect(result.exitCode).toBeNull()
    expect(result.stdout).toContain('Versions valid (live: v1, v2)')
    expect(result.stdout).toContain('No errors found')
  })

  it('does not pile version errors on top of a cross-reference error', async () => {
    // Version checks need a registry that is otherwise sound; against a broken
    // one every version error is noise caused by the first.
    // MUTATION: run the version check even when crossRefErrors is non-empty.
    // The orphaned-tombstone message then also appears.
    project.writeType('content--blog_post', [
      title,
      { name: 'author', label: 'Author', type: 'reference', target: 'content--does_not_exist', rel: 'one-to-one', required: false },
      { name: 'legacy', column: 'legacy_col', label: 'Legacy', type: 'text/plain', required: false, removed: true },
    ])

    const result = await run(() => runValidate({}, { cwd: project.root }))

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('content--does_not_exist')
    expect(result.stderr).not.toContain(ORPHANED)
  })
})

describe('manguito build — version model', () => {
  it('rejects the same error as validate, before writing any generated file', async () => {
    // The spec's invariant: validate and build reject the same version errors.
    // MUTATION: move build's version check back to after the codegen writes.
    // dist/generated then exists when build exits.
    project.writeType('content--blog_post', [title])
    snapshot(project, 'v1')
    project.writeType('content--blog_post', [{ ...title, type: 'integer' }])

    const result = await run(() => runBuild({}, { cwd: project.root }))

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(TYPE_CHANGED)
    expect(fs.existsSync(path.join(project.root, 'dist', 'generated'))).toBe(false)
  })
})
```

The cross-reference test assumes a `reference` field whose `target` names a type that does not exist parses cleanly but fails `validateCrossReferences`, with a message naming the missing target. Step 3's red run will show whether that holds. If the field fails at *parse* time instead, pick any other schema mistake that parses but fails cross-reference validation. Find one in `validateCrossReferences` (`packages/core/src/parser/validate.ts`) and say which in your report.

- [ ] **Step 3: Run them and confirm they fail**

```bash
cd packages/cli
pnpm exec dotenv -e ../../.env.test -- vitest run tests/validate-versions.test.ts
```

Expected:
- The three rejection tests FAIL: `exitCode` is `null`, and stdout says "No errors found".
- The valid-project test FAILS: it expects a "Versions valid" line that does not exist yet.
- The cross-reference test PASSES already. It is a guard for after Step 5, so record that it passed and why.
- The build test FAILS, because `dist/generated` exists.

Record what you saw.

- [ ] **Step 4: Write the helper**

Create `packages/cli/src/utils/project-version-model.ts`:

```typescript
import {
  loadVersionSnapshots,
  computeVersionModel,
  type Result,
  type ResolvedSchemaConfig,
  type SchemaRegistry,
  type VersionModel,
  type VersionSnapshot,
} from '@bobbykim/manguito-cms-core'

/**
 * The project's version model: its snapshots, then the model computed from
 * them and the working registry. Every command that needs the model comes
 * through here (validate, build, dev and the version:* commands), so no two
 * commands can disagree about which schemas are valid. That disagreement is
 * how validate came to pass schemas build rejected.
 *
 * Returns errors instead of printing or exiting. validate collects them with
 * every other error it found; build, dev and the version commands print them
 * and stop. The model is computed only once the snapshots loaded: a model
 * built from part of the snapshot set would report errors that are not real.
 */
export function loadProjectVersionModel(
  schema: ResolvedSchemaConfig,
  registry: SchemaRegistry
): Result<{ snapshots: VersionSnapshot[]; model: VersionModel }> {
  const snapshots = loadVersionSnapshots(schema, registry)
  if (!snapshots.ok) return snapshots
  const model = computeVersionModel({ current: registry, snapshots: snapshots.value })
  if (!model.ok) return model
  return { ok: true, value: { snapshots: snapshots.value, model: model.value } }
}
```

- [ ] **Step 5: Use it in `validate`**

In `packages/cli/src/commands/validate.ts`, add the imports:

```typescript
import { resolveSchemaConfig } from '../utils/schema-config.js'
import { loadProjectVersionModel } from '../utils/project-version-model.js'
```

Declare `let liveVersions: string[] | null = null` just before the `// 6. Cross-reference validation` block. Then, inside that block after `allErrors.push(...crossRefErrors)`, add:

```typescript
    // Version checks run only against a registry that is otherwise sound.
    // Against a broken one every version error would be noise caused by the
    // first error, so the author would be fixing the wrong thing.
    if (crossRefErrors.length === 0) {
      const versions = loadProjectVersionModel(resolveSchemaConfig(cwd, config), registry)
      if (versions.ok) liveVersions = versions.value.model.live
      else allErrors.push(...versions.errors)
    }
```

In the success block, after `printSuccess('routes.json valid')`, add:

```typescript
  if (liveVersions !== null) printSuccess(`Versions valid (live: ${liveVersions.join(', ')})`)
```

In `packages/cli/tests/validate.test.ts`, that file mocks all of core, so the module would now import two functions the mock does not define. Add both to the `vi.mock('@bobbykim/manguito-cms-core', ...)` factory:

```typescript
  loadVersionSnapshots: vi.fn().mockReturnValue({ ok: true, value: [] }),
  computeVersionModel: vi.fn().mockReturnValue({
    ok: true,
    value: { current: 'v1', live: ['v1'], union: {}, projections: {} },
  }),
```

Add both names to that file's import from `'@bobbykim/manguito-cms-core'`. Re-establish the same two return values in its `beforeEach` after `vi.resetAllMocks()`, the way it already re-establishes the other mocks. Change no assertion in that file.

- [ ] **Step 6: Use it in `build`, before any write**

In `packages/cli/src/commands/build.ts`:
- Add `import { loadProjectVersionModel } from '../utils/project-version-model.js'`.
- Remove `loadVersionSnapshots` and `computeVersionModel` from the core import if nothing else uses them.

Immediately after `const registry = buildSchemaRegistry(...)` and before `printSuccess('Config loaded')`, add:

```typescript
  // Checked BEFORE any codegen write: a failed build must leave nothing half
  // written under dist/generated.
  const versions = loadProjectVersionModel(resolveSchemaConfig(cwd, config), registry)
  if (!versions.ok) {
    printValidationErrors(versions.errors, 'Version model errors', 'manguito build')
    process.exit(1)
  }
```

Delete the later block that runs from `const schema = resolveSchemaConfig(cwd, config)` through the second `process.exit(1)`. Then change the two lines that follow it to:

```typescript
  await generateVersionModel(versions.value.model, generatedDir)
  printSuccess(`Version model baked (live: ${versions.value.model.live.join(', ')})`)
```

- [ ] **Step 7: Use it in `dev`, pointing at `validate`**

In `packages/cli/src/commands/dev.ts`, there are two blocks that call `loadVersionSnapshots` and then `computeVersionModel`: one at startup (step 7b) and one in the reload handler. Replace each pair with one helper call. At startup:

```typescript
  const versionsResult = loadProjectVersionModel(resolveSchemaConfig(cwd, config), registry)
  if (!versionsResult.ok) {
    printValidationErrors(versionsResult.errors, 'Version model errors', 'manguito validate')
    process.exit(1)
  }
  const versionModel = reduceVersionModel(versionsResult.value.model)
```

In the reload handler, keep its existing "warn and keep serving" policy:

```typescript
  const versionsResult = loadProjectVersionModel(resolveSchemaConfig(cwd, config), registry)
  if (!versionsResult.ok) {
    printValidationErrors(versionsResult.errors, 'Version model errors', 'manguito validate')
    process.stderr.write('⚠ Changes not applied.\n')
    return
  }
  const versionModel = reduceVersionModel(versionsResult.value.model)
```

Two more edits in `dev.ts`:
- **Delete the comment that concedes the gap.** It begins "`manguito validate` never loads version snapshots". Keep the comment above each block that explains why the model is recomputed.
- **Tidy the imports.** Add the helper's import, and drop `loadVersionSnapshots` and `computeVersionModel` from the core import if nothing else uses them.

- [ ] **Step 8: Use it in `loadVersionContext`, and expose the API prefix**

In `packages/cli/src/commands/version.ts`, add `apiPrefix: string` to `VersionContext`. Replace the body of `loadVersionContext` from `const snapshots = loadVersionSnapshots(...)` to the end with:

```typescript
  const versions = loadProjectVersionModel(schema, registry)
  if (!versions.ok) {
    printValidationErrors(versions.errors, 'Version model errors', command)
    process.exit(1)
  }

  return {
    schema,
    registry,
    snapshots: versions.value.snapshots,
    model: versions.value.model,
    // Same default `dev` uses: the prefix the served routes actually carry.
    apiPrefix: config.api.prefix ?? '/api',
  }
```

Import the helper, and drop `loadVersionSnapshots` and `computeVersionModel` from the core import if nothing else in the file uses them.

- [ ] **Step 9: Add the `dev` test**

In `packages/cli/tests/dev.test.ts`, add inside `describe('runDev')`:

```typescript
  it('points an invalid version model at `manguito validate`', async () => {
    // validate now runs the same check, so it is the command that shows these
    // errors in full. MUTATION: keep 'manguito version:diff' as the command
    // named in dev's startup error.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    vi.mocked(connectDb).mockResolvedValue(makeDb([{ rows: [{ count: 1 }] }]) as never)
    vi.mocked(computeVersionModel).mockReturnValue({
      ok: false,
      errors: [{ file: 'schemas/versions/v1', code: 'FIELD_TYPE_CHANGED_WHILE_LIVE', message: 'type changed' }],
    } as never)

    await expect(runDev({}, { cwd: FAKE_CWD })).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('manguito validate'))
    expect(process.stderr.write).not.toHaveBeenCalledWith(expect.stringContaining('version:diff'))
    exitSpy.mockRestore()
  })
```

`connectDb`, `makeDb` and `computeVersionModel` are already imported or defined in that file. Confirm with `grep -n "connectDb\|function makeDb\|computeVersionModel" packages/cli/tests/dev.test.ts`.

- [ ] **Step 10: Run the tests, then verify each bites**

```bash
cd packages/cli
pnpm exec dotenv -e ../../.env.test -- vitest run tests/validate-versions.test.ts tests/validate.test.ts tests/dev.test.ts tests/build.test.ts
```

Expected: all pass. Then apply each new test's named mutation, watch it fail, restore it, and watch it pass. Record each result.

- [ ] **Step 11: Full gates**

```bash
pnpm --filter @bobbykim/manguito-cms-cli test
pnpm --filter @bobbykim/manguito-cms-cli typecheck
pnpm --filter @bobbykim/manguito-cms-cli lint
pnpm build
```

Expected: cli rises by **+7 tests** (+6 in the new file, +1 in `dev.test.ts`), with one new test file. `build.test.ts` must pass unmodified: it mocks core, so the helper there runs the mocked functions.

- [ ] **Step 12: Commit**

```bash
git add packages/cli
git commit -m "fix(cli): make validate reject the version errors build rejects

validate never computed the version model, so it reported \"No errors
found\" on schemas build refused, and version:retire's promise that
validate would report ORPHANED_TOMBSTONE was false. One helper now
composes the snapshot load and the model for validate, build, dev and
the version commands.

build checks the model before writing into dist/generated, so a failed
build leaves nothing half written."
```

---

### Task 2: `version:create`, and `version:cut` as a deprecated alias

`version:cut` is named for its mechanism. `version:create` does the same thing with messages that say what happens. On a first run it explains that the working schema is already v1 and becomes v2. A probe also found that today's live-set lines leave out the working schema: a first cut prints "After cutting, v1 are live" and "Live: v1.", although v2 is live too.

**Files:**
- Modify: `packages/cli/src/commands/version.ts` — the file header comment, `registerVersion`, `runVersionCut` (renamed `runVersionCreate`), `runVersionDiff`'s messages, and `runVersionRetire`'s messages
- Modify: `packages/cli/src/commands/version-report.ts` — `formatSchemaChange`'s first-run header
- Test: `packages/cli/tests/version-create.test.ts` (new), `packages/cli/src/__tests__/version-report.test.ts`

**Interfaces:**
- Consumes: Task 1's `VersionContext.apiPrefix`, and `makeTempProject`, `run` and `snapshot` from `tests/support/temp-project.ts`.
- Produces: `runVersionCreate(options: { env?: string; yes?: boolean }, deps: { cwd: string; prompt: PromptAdapter }): Promise<void>`, exported from `version.ts`. `runVersionCut` no longer exists.
- Produces: `VERSION_CUT_DEPRECATION: string`, exported from `version.ts`. It is the exact line the alias writes to stderr.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/tests/version-create.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { makeTempProject, run, snapshot, type TempProject } from './support/temp-project.js'

let project: TempProject

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))
vi.mock('../src/utils/config.js', () => ({
  resolveConfig: vi.fn(async () => ({
    schema: {
      base_path: project.schemas,
      folders: {
        content_types: 'content-types',
        paragraph_types: 'paragraph-types',
        taxonomy_types: 'taxonomy-types',
        enum_types: 'enum-types',
      },
    },
    api: { prefix: '/api', media: undefined },
  })),
}))
// A prompt that fails the test instead of waiting on stdin forever: every
// run here passes --yes, so any prompt at all is a bug.
vi.mock('../src/utils/prompt.js', () => ({
  createPromptAdapter: () => ({
    confirm: async () => {
      throw new Error('prompted although --yes was given')
    },
  }),
}))

import { registerVersion, runVersionCreate, runVersionRetire, VERSION_CUT_DEPRECATION } from '../src/commands/version.js'

const neverPrompt = {
  confirm: async () => {
    throw new Error('prompted although --yes was given')
  },
} as never
const title = { name: 'title', label: 'Title', type: 'text/plain', required: false }
const create = () => runVersionCreate({ yes: true }, { cwd: project.root, prompt: neverPrompt })
const versionsDir = () => path.join(project.schemas, 'versions')

function program(): Command {
  const p = new Command()
  p.exitOverride()
  registerVersion(p)
  return p
}

beforeEach(() => {
  project = makeTempProject()
  project.writeType('content--blog_post', [title])
})
afterEach(() => {
  project.cleanup()
})

describe('version:create', () => {
  it('creates v1 on a new project and explains what that means, even with --yes', async () => {
    // MUTATION: print the first-run explanation only when prompting (inside
    // `if (options.yes !== true)`). It then disappears from this --yes run.
    const result = await run(create)

    expect(result.exitCode).toBeNull()
    expect(fs.existsSync(path.join(versionsDir(), 'v1', 'content-types', 'content--blog_post.json'))).toBe(true)
    expect(result.stdout).toContain('This creates v1 from your working schema. /api/v1 keeps serving it')
    expect(result.stdout).toContain('your working schema becomes v2, served at /api/v2 and /api.')
  })

  it('lists the working schema among the live versions after a create', async () => {
    // Today's cut omits the working schema ("v1 are live").
    // MUTATION: drop `next` from the live-after list.
    const result = await run(create)

    expect(result.stdout).toContain('After creating v1, these versions are live: v1 v2.')
    expect(result.stdout).toContain('Live: v1 v2.  Working schema is now v2.')
  })

  it('does not repeat the first-run explanation once a version exists', async () => {
    // MUTATION: drop the `from === null` condition on the explanation.
    snapshot(project, 'v1')
    project.writeType('content--blog_post', [{ ...title, name: 'heading', column: 'title' }])

    const result = await run(create)

    expect(result.exitCode).toBeNull()
    expect(fs.existsSync(path.join(versionsDir(), 'v2'))).toBe(true)
    expect(result.stdout).not.toContain('This creates')
    expect(result.stdout).toContain('After creating v2, these versions are live: v1 v2 v3.')
  })

  it('refuses a second create with nothing changed, and writes nothing', async () => {
    // Review Focus #3. MUTATION: remove the `change.identical` refusal.
    // versions/v2 then gets written.
    snapshot(project, 'v1')

    const result = await run(create)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('creating v2 would freeze an identical contract')
    expect(fs.existsSync(path.join(versionsDir(), 'v2'))).toBe(false)
  })
})

describe('version:cut (deprecated alias)', () => {
  it('warns on stderr, forwards --yes, and creates the version', async () => {
    // Review Focus #2: a dropped --yes would make the alias prompt, and the
    // prompt mock throws. MUTATION: call runVersionCreate({}, …) in the alias
    // action instead of passing its options through.
    const result = await run(() => program().parseAsync(['node', 'manguito', 'version:cut', '--yes']))

    expect(result.exitCode).toBeNull()
    expect(result.stderr).toBe(VERSION_CUT_DEPRECATION)
    expect(fs.existsSync(path.join(versionsDir(), 'v1'))).toBe(true)
  })

  it('writes exactly what version:create writes to stdout', async () => {
    // A script parsing the old command's stdout must not break.
    // MUTATION: write the deprecation line to stdout instead of stderr.
    const viaAlias = await run(() => program().parseAsync(['node', 'manguito', 'version:cut', '--yes']))
    const aliasRoot = project.root
    project.cleanup()
    project = makeTempProject()
    project.writeType('content--blog_post', [title])
    const viaCreate = await run(() => program().parseAsync(['node', 'manguito', 'version:create', '--yes']))

    const normalize = (s: string, root: string) => s.split(root).join('<root>')
    expect(normalize(viaAlias.stdout, aliasRoot)).toBe(normalize(viaCreate.stdout, project.root))
  })

  it('is hidden from help while version:create is listed', () => {
    // MUTATION: register version:cut without `{ hidden: true }`.
    const help = program().helpInformation()

    expect(help).toContain('version:create')
    expect(help).not.toContain('version:cut')
  })
})

describe('version:retire — renamed messages', () => {
  it('tells a project with no versions to run version:create', async () => {
    // MUTATION: keep the old "run `manguito version:cut` first" text.
    const result = await run(() =>
      runVersionRetire('v1', { yes: true }, { cwd: project.root, prompt: neverPrompt })
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('No versions have been created yet — run `manguito version:create` first.')
  })
})
```

In `packages/cli/src/__tests__/version-report.test.ts`, inside the test `'describes the first cut when from is null'`, add one assertion after the existing two:

```typescript
    // MUTATION: keep the old "nothing has been cut yet" wording.
    expect(out).toContain('nothing has been created yet')
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd packages/cli
pnpm exec dotenv -e ../../.env.test -- vitest run tests/version-create.test.ts src/__tests__/version-report.test.ts
```

Expected: the new file fails to import, because `runVersionCreate` and `VERSION_CUT_DEPRECATION` do not exist yet. The version-report test fails on the new assertion. Record what you saw.

- [ ] **Step 3: Rename the handler and rewrite its messages**

In `packages/cli/src/commands/version.ts`, change the file's first line to:

```typescript
// manguito version:create / version:list / version:diff / version:retire — the schema version lifecycle
```

Add the deprecation line as an export, above `registerVersion`:

```typescript
/** Written to stderr by the deprecated `version:cut` alias, so its stdout matches `version:create`'s exactly. */
export const VERSION_CUT_DEPRECATION =
  '`version:cut` is deprecated — use `version:create`. It will be removed in a future release.\n'
```

Rename `runVersionCut` to `runVersionCreate`. Pass `'manguito version:create'` as its `loadVersionContext` command, and make these message changes inside it:

- **The identical-schema refusal** becomes:

  ```typescript
      printGuidedError(
        `No column was added, renamed, tombstoned or restored since ${from?.version ?? 'the working schema began'} — creating ${version} would freeze an identical contract.`,
        'Changes to paragraph, programmatic, many-to-many and enum definitions are not versioned and need no new version. A live version commits you to retaining every column it exposes, so create one only when a column actually changed — or run `manguito version:retire <version>` if you meant to shrink the live set.'
      )
  ```

- **The existing-directory hint** says "then run version:create again."

- **Replace everything from `process.stdout.write(\`${formatSchemaChange(change)}\n\n\`)` up to the `if (options.yes !== true)` line** with the block below. It keeps the change report, adds the first-run explanation and fixes the live-set line:

  ```typescript
    process.stdout.write(`${formatSchemaChange(change)}\n\n`)

    // The working schema is live too, as the version after the one created.
    // Listing only the snapshots told a first-time author "v1 are live" and
    // hid that their working schema had just become v2.
    const next = `v${Number.parseInt(version.slice(1), 10) + 1}`
    const liveAfter = [...ctx.model.live.filter((v) => v !== version), version, next]

    // A first create is the moment versioning becomes visible, so say what it
    // does to the URLs. Printed with --yes too: it explains, it does not ask.
    if (from === null) {
      const prefix = ctx.apiPrefix
      process.stdout.write(
        `This creates ${version} from your working schema. ${prefix}/${version} keeps serving it\n` +
          `unchanged; your working schema becomes ${next}, served at ${prefix}/${next} and ${prefix}.\n\n`
      )
    }

    process.stdout.write(
      `After creating ${version}, these versions are live: ${liveAfter.join(' ')}. Every column they\n` +
        `expose must stay in the schema — as a live field or a tombstone — until you retire them.\n\n`
    )
  ```

  Delete the old `const live = …` computation and the comment above it. The `version` and `next` construction replaces it.

- **The prompt** becomes `` `Create ${version} from the working schema?` ``.
- **The two success lines** become:

  ```typescript
    printSuccess(`Created ${version} at ${target}`)
    process.stdout.write(`Live: ${liveAfter.join(' ')}.  Working schema is now ${next}.\n`)
  ```

In `runVersionDiff`, make two message changes:
- "Nothing to cut" becomes "Nothing to create".
- `Cutting now would create` becomes `Creating a version now would write`.

In `runVersionRetire`, make these message changes:
- `${version} is not a cut version.` becomes `${version} is not a created version.`
- `'No versions have been cut yet — run \`manguito version:cut\` first.'` becomes `'No versions have been created yet — run \`manguito version:create\` first.'`
- `` `Cut versions: ${existing}.` `` becomes `` `Created versions: ${existing}.` ``
- In the newest-version refusal: "newest cut version" becomes "newest created version". "Cutting a version with a real contract change" becomes "Creating a newer version with a real contract change". "was cut in error" becomes "was created in error".
- The orphan note `'Until you do, \`manguito validate\` will report ORPHANED_TOMBSTONE. Deleting them\n'` becomes `'Until you do, \`manguito validate\` and \`manguito build\` will fail. Deleting them\n'`. Task 1 made `validate` fail here, but the printer shows messages, not the code, so the old wording promised output that never appears.

In the `loadVersionContext` doc comment, "makes cutting safe to offer" becomes "makes creating a version safe to offer", and "after the cut" becomes "after the write".

- [ ] **Step 4: Register `version:create` and the hidden alias**

In `registerVersion`, replace the `version:cut` registration with:

```typescript
  program
    .command('version:create')
    .description('Create a version: freeze the working schema so it keeps being served unchanged')
    .option('--env <path>', 'path to .env file to load')
    .option('--yes', 'skip the confirmation prompt')
    .action(async (options: { env?: string; yes?: boolean }) => {
      await runVersionCreate(options, { cwd: process.cwd(), prompt: createPromptAdapter() })
    })

  // Deprecated alias of version:create, kept so scripts and CI written against
  // 0.6 keep working. Hidden from --help; it warns on stderr so its stdout
  // stays identical to version:create's.
  program
    .command('version:cut', { hidden: true })
    .option('--env <path>', 'path to .env file to load')
    .option('--yes', 'skip the confirmation prompt')
    .action(async (options: { env?: string; yes?: boolean }) => {
      process.stderr.write(VERSION_CUT_DEPRECATION)
      await runVersionCreate(options, { cwd: process.cwd(), prompt: createPromptAdapter() })
    })
```

Change `version:diff`'s description to `'Show what creating a new version would freeze'`. Change `version:retire`'s description to `'Stop serving a created version and delete its snapshot'`.

- [ ] **Step 5: Reword the report header**

In `packages/cli/src/commands/version-report.ts`, `formatSchemaChange`'s null-`from` header becomes:

```typescript
      ? `Working schema — nothing has been created yet, so ${change.to} would be the first version`
```

- [ ] **Step 6: Run the tests, then verify each bites**

```bash
cd packages/cli
pnpm exec dotenv -e ../../.env.test -- vitest run tests/version-create.test.ts tests/validate-versions.test.ts src/__tests__/version-report.test.ts
```

Expected: all pass. Apply each new test's named mutation, watch it fail, restore it, and watch it pass. Record each result. Then confirm that no "cut" wording survives in the source outside the alias and its comment:

```bash
grep -rn -i "\bcut\b\|cutting" packages/cli/src --include=*.ts | grep -v __tests__
```

Expected: only the `version:cut` registration, `VERSION_CUT_DEPRECATION`, and the alias's comment.

- [ ] **Step 7: Full gates**

```bash
pnpm --filter @bobbykim/manguito-cms-cli test
pnpm --filter @bobbykim/manguito-cms-cli typecheck
pnpm --filter @bobbykim/manguito-cms-cli lint
pnpm build
```

Expected: cli rises by **+8 tests** in the new file. The version-report test gains an assertion, not a test.

- [ ] **Step 8: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): rename version:cut to version:create

version:create freezes the working schema exactly as version:cut did,
with messages that say what happens: a first create explains that the
working schema becomes the next version, and the live set now includes
it. version:cut remains as a hidden alias that warns on stderr."
```

---

### Task 3: `version:list`

A read-only answer to "which versions am I serving?". It gives one line per live version, oldest first, with each older version's distance from current. The distance comes from the same column-keyed `describeSchemaChange` that `version:diff` uses.

**Files:**
- Modify: `packages/cli/src/commands/version-report.ts` — add `formatVersionList`
- Modify: `packages/cli/src/commands/version.ts` — add `runVersionList` and its registration
- Create: `.changeset/version-create-and-list.md`
- Test: `packages/cli/src/__tests__/version-report.test.ts`, `packages/cli/tests/version-list.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's `VersionContext.apiPrefix`; Task 2's `runVersionCreate`; the support module from Task 1.
- Produces: `formatVersionList(input: { prefix: string; current: string; older: Array<{ version: string; change: SchemaChange }> }): string`, and `runVersionList(options: { env?: string }, deps: { cwd: string }): Promise<void>`.

- [ ] **Step 1: Write the failing formatter tests**

Append to `packages/cli/src/__tests__/version-report.test.ts`. Import `formatVersionList` alongside `formatSchemaChange`:

```typescript
describe('formatVersionList', () => {
  const change = (fields: SchemaChange['types'][number]['fields']): SchemaChange => ({
    from: 'v1', to: 'v3', identical: fields.length === 0,
    types: [{ type: 'content--blog_post', status: 'present', fields }],
  })

  it('says plainly when no version has been created', () => {
    // MUTATION: render an empty table instead of the guidance.
    expect(formatVersionList({ prefix: '/api', current: 'v1', older: [] })).toBe(
      'No versions created yet. Your working schema is v1, served at /api/v1 and /api.\n' +
        'Run `manguito version:create` before making a breaking change.'
    )
  })

  it('lists live versions oldest first with drift, then current', () => {
    // MUTATION: count `tombstoned` under "added". The v1 line then reads
    // "1 renamed, 2 added since".
    const out = formatVersionList({
      prefix: '/api',
      current: 'v3',
      older: [
        {
          version: 'v1',
          change: change([
            { kind: 'renamed', column: 'title', from_name: 'title', to_name: 'heading' },
            { kind: 'tombstoned', column: 'body', name: 'body' },
            { kind: 'added', column: 'summary', name: 'summary', field_type: 'text/plain' },
          ]),
        },
        { version: 'v2', change: change([]) },
      ],
    })

    expect(out).toBe(
      [
        'Live versions (3):',
        '  v1  /api/v1  1 renamed, 1 removed, 1 added since',
        '  v2  /api/v2  identical to current',
        '  v3  /api/v3  current — also /api',
      ].join('\n')
    )
  })

  it('counts restored fields and omits zero counts', () => {
    // MUTATION: print every kind, zeros included.
    const out = formatVersionList({
      prefix: '/content',
      current: 'v2',
      older: [{ version: 'v1', change: change([{ kind: 'restored', column: 'x', name: 'x' }]) }],
    })

    expect(out).toContain('  v1  /content/v1  1 restored since')
    expect(out).toContain('  v2  /content/v2  current — also /content')
  })

  it('does not call a version identical when only a column-less type was added', () => {
    // describeSchemaChange reports identical: false for a new type even when
    // none of its fields has a column. MUTATION: return 'identical to current'
    // whenever no field counts are non-zero.
    const out = formatVersionList({
      prefix: '/api',
      current: 'v2',
      older: [{
        version: 'v1',
        change: { from: 'v1', to: 'v2', identical: false, types: [{ type: 'content--page', status: 'added', fields: [] }] },
      }],
    })

    expect(out).toContain('  v1  /api/v1  1 new type since')
  })
})
```

- [ ] **Step 2: Write the failing end-to-end tests**

Create `packages/cli/tests/version-list.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { makeTempProject, run, type TempProject } from './support/temp-project.js'

let project: TempProject
let apiPrefix = '/api'

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))
vi.mock('../src/utils/config.js', () => ({
  resolveConfig: vi.fn(async () => ({
    schema: {
      base_path: project.schemas,
      folders: {
        content_types: 'content-types',
        paragraph_types: 'paragraph-types',
        taxonomy_types: 'taxonomy-types',
        enum_types: 'enum-types',
      },
    },
    api: { prefix: apiPrefix, media: undefined },
  })),
}))

import { registerVersion, runVersionCreate, runVersionList, runVersionRetire } from '../src/commands/version.js'

const neverPrompt = {
  confirm: async () => {
    throw new Error('prompted although --yes was given')
  },
} as never
const field = (name: string, extra: object = {}) => ({ name, label: name, type: 'text/plain', required: false, ...extra })
const create = () => run(() => runVersionCreate({ yes: true }, { cwd: project.root, prompt: neverPrompt }))
const list = () => run(() => runVersionList({}, { cwd: project.root }))

beforeEach(() => {
  apiPrefix = '/api'
  project = makeTempProject()
})
afterEach(() => {
  project.cleanup()
})

describe('version:list', () => {
  it('guides a project with no versions', async () => {
    project.writeType('content--blog_post', [field('title')])

    const result = await list()

    expect(result.exitCode).toBeNull()
    expect(result.stdout).toContain('No versions created yet. Your working schema is v1, served at /api/v1 and /api.')
  })

  it('summarises how far each live version is behind current', async () => {
    // MUTATION: compare each snapshot with itself instead of with the working
    // schema. Every line then reads "identical to current".
    project.writeType('content--blog_post', [field('title'), field('body')])
    await create() // v1: title, body
    project.writeType('content--blog_post', [
      field('heading', { column: 'title' }),
      field('body', { removed: true }),
      field('summary'),
    ])
    await create() // v2: v1 with title renamed, body removed, summary added

    const result = await list()

    expect(result.exitCode).toBeNull()
    expect(result.stdout).toContain('  v1  /api/v1  1 renamed, 1 removed, 1 added since')
    expect(result.stdout).toContain('  v2  /api/v2  identical to current')
    expect(result.stdout).toContain('  v3  /api/v3  current — also /api')
  })

  it('skips a retired version and still measures the others', async () => {
    // Review Focus #4. MUTATION: list every number from v1 to current instead
    // of the live set. A "v2" line then appears.
    project.writeType('content--blog_post', [field('title')])
    await create() // v1
    project.writeType('content--blog_post', [field('title'), field('a')])
    await create() // v2
    project.writeType('content--blog_post', [field('title'), field('a'), field('b')])
    await create() // v3
    await run(() => runVersionRetire('v2', { yes: true }, { cwd: project.root, prompt: neverPrompt }))

    const result = await list()

    expect(result.stdout).toContain('Live versions (3):')
    expect(result.stdout).toContain('  v1  /api/v1  2 added since')
    expect(result.stdout).not.toContain('v2')
    expect(result.stdout).toContain('  v3  /api/v3  identical to current')
    expect(result.stdout).toContain('  v4  /api/v4  current — also /api')
  })

  it('counts the fields of a type added after a version was created', async () => {
    // Review Focus #5. MUTATION: skip types whose status is 'added'. v1 then
    // reads "identical to current".
    project.writeType('content--blog_post', [field('title')])
    await create() // v1
    project.writeType('content--page', [field('heading'), field('body')])

    const result = await list()

    expect(result.stdout).toContain('  v1  /api/v1  2 added since')
  })

  it('uses the configured API prefix', async () => {
    // MUTATION: hard-code '/api' instead of ctx.apiPrefix.
    apiPrefix = '/content'
    project.writeType('content--blog_post', [field('title')])
    await create()

    const result = await list()

    expect(result.stdout).toContain('  v1  /content/v1  identical to current')
    expect(result.stdout).toContain('  v2  /content/v2  current — also /content')
  })

  it('exits with the model errors when the model is invalid', async () => {
    // Same preamble as diff/create/retire. MUTATION: catch the model error and
    // print the table anyway.
    project.writeType('content--blog_post', [
      field('title'),
      field('legacy', { column: 'legacy_col', removed: true }),
    ])

    const result = await list()

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('no live version exposes that column any more')
  })

  it('appears in help', () => {
    // MUTATION: leave version:list unregistered.
    const p = new Command()
    registerVersion(p)
    expect(p.helpInformation()).toContain('version:list')
  })
})
```

The "added type" test writes a second content type with the default base path `posts`. The version commands parse the schema but do not run cross-reference validation, so a shared base path should not matter here. If the red run shows otherwise, give `writeType` a distinct base path and add it to the project's `routes.json`. Say so in your report.

- [ ] **Step 3: Run them and confirm they fail**

```bash
cd packages/cli
pnpm exec dotenv -e ../../.env.test -- vitest run src/__tests__/version-report.test.ts tests/version-list.test.ts
```

Expected: both files fail to import the missing exports. Record what you saw.

- [ ] **Step 4: Write the formatter**

Append to `packages/cli/src/commands/version-report.ts`:

```typescript
// One count per kind, summed across types, so a version's line says how far
// behind current it is without the per-field detail `version:diff` gives.
function driftSummary(change: SchemaChange): string {
  const counts = { renamed: 0, tombstoned: 0, added: 0, restored: 0 }
  for (const type of change.types) {
    for (const field of type.fields) counts[field.kind]++
  }
  const parts: string[] = []
  if (counts.renamed > 0) parts.push(`${counts.renamed} renamed`)
  // "removed" is what an author did; "tombstoned" is how the schema records it.
  if (counts.tombstoned > 0) parts.push(`${counts.tombstoned} removed`)
  if (counts.added > 0) parts.push(`${counts.added} added`)
  if (counts.restored > 0) parts.push(`${counts.restored} restored`)
  if (parts.length > 0) return `${parts.join(', ')} since`
  if (change.identical) return 'identical to current'
  // Not identical, yet no column changed: a type was added whose fields are
  // all column-less (paragraph, programmatic or many-to-many). Say so rather
  // than call it identical.
  const newTypes = change.types.filter((t) => t.status === 'added').length
  return `${newTypes} new type${newTypes === 1 ? '' : 's'} since`
}

/**
 * The `version:list` body, without a trailing newline. `older` is every live
 * snapshot, oldest first, each compared with the working schema. Empty means
 * nothing has been created: the newest snapshot can never be retired, so a
 * project with any snapshot always has at least one here.
 */
export function formatVersionList(input: {
  prefix: string
  current: string
  older: Array<{ version: string; change: SchemaChange }>
}): string {
  const { prefix, current, older } = input
  if (older.length === 0) {
    return (
      `No versions created yet. Your working schema is ${current}, served at ${prefix}/${current} and ${prefix}.\n` +
      'Run `manguito version:create` before making a breaking change.'
    )
  }

  const rows: Array<[string, string, string]> = [
    ...older.map((o): [string, string, string] => [o.version, `${prefix}/${o.version}`, driftSummary(o.change)]),
    [current, `${prefix}/${current}`, `current — also ${prefix}`],
  ]
  const nameWidth = Math.max(...rows.map((r) => r[0].length))
  const pathWidth = Math.max(...rows.map((r) => r[1].length))
  return [
    `Live versions (${rows.length}):`,
    ...rows.map(([name, url, note]) => `  ${name.padEnd(nameWidth)}  ${url.padEnd(pathWidth)}  ${note}`),
  ].join('\n')
}
```

`SchemaChange` is already imported as a type at the top of this file.

- [ ] **Step 5: Write the handler and register it**

In `packages/cli/src/commands/version.ts`, import `formatVersionList` alongside `formatSchemaChange`, and add:

```typescript
export async function runVersionList(
  options: { env?: string },
  deps: { cwd: string }
): Promise<void> {
  const ctx = await loadVersionContext(options, deps, 'manguito version:list')
  const current = ctx.model.current
  const versionNumber = (v: string) => Number.parseInt(v.slice(1), 10)

  // Every snapshot directory is a live version: presence is the truth, so a
  // retired version is simply absent. Compared with the WORKING schema, which
  // is what a consumer of that version is behind.
  const older = [...ctx.snapshots]
    .sort((a, b) => versionNumber(a.version) - versionNumber(b.version))
    .map((s) => ({
      version: s.version,
      change: describeSchemaChange({ from: s, to: { version: current, registry: ctx.registry } }),
    }))

  process.stdout.write(`${formatVersionList({ prefix: ctx.apiPrefix, current, older })}\n`)
}
```

In `registerVersion`, register it directly after `version:create`:

```typescript
  program
    .command('version:list')
    .description('List the versions being served and how far each is behind the working schema')
    .option('--env <path>', 'path to .env file to load')
    .action(async (options: { env?: string }) => {
      await runVersionList(options, { cwd: process.cwd() })
    })
```

- [ ] **Step 6: Add the changeset**

Create `.changeset/version-create-and-list.md`:

```markdown
---
'@bobbykim/manguito-cms-cli': minor
---

Make the schema version lifecycle say what it does, and make `validate` check it.

- `manguito version:create` replaces `version:cut`. It freezes the working
  schema exactly as before. On a project with no versions it explains that the
  working schema is already v1 and becomes v2, and it now lists the working
  schema among the live versions.
- `manguito version:cut` still works as a hidden alias. It prints a
  deprecation notice on stderr and will be removed in a future release.
- New `manguito version:list` shows every live version, its path, and how many
  fields have been renamed, removed, added or restored since.
- `manguito validate` now rejects the version errors `manguito build` rejects:
  a broken snapshot, a field type changed while a version is live, a column a
  live version needs, and a leftover removed field. A schema that passed
  `validate` before may now fail it.
- `manguito build` checks the version model before writing any generated
  file, so a failed build no longer leaves partial output in `dist/generated`.
```

- [ ] **Step 7: Run the tests, then verify each bites**

```bash
cd packages/cli
pnpm exec dotenv -e ../../.env.test -- vitest run src/__tests__/version-report.test.ts tests/version-list.test.ts tests/version-create.test.ts
```

Expected: all pass. Apply each new test's named mutation, watch it fail, restore it, and watch it pass. Record each result.

- [ ] **Step 8: Full gates**

```bash
pnpm --filter @bobbykim/manguito-cms-cli test
pnpm --filter @bobbykim/manguito-cms-cli typecheck
pnpm --filter @bobbykim/manguito-cms-cli lint
pnpm build
```

Expected: cli rises by **+11 tests**: +4 in `version-report.test.ts` and +7 in the new file.

- [ ] **Step 9: Commit**

```bash
git add packages/cli .changeset/version-create-and-list.md
git commit -m "feat(cli): add version:list

Shows every live version, oldest first, with its path and how many
fields have been renamed, removed, added or restored since, measured
with the same column-keyed comparison version:diff uses."
```

---

### Task 4: The user guide and the docs that point to it

A user today cannot find out how to rename or remove a field safely. The README still lists versioning as planned.

**Files:**
- Create: `docs/schema-versioning.md`
- Modify: `docs/schema-authoring.md` — after the field-types table, before `### The \`enum\` field's XOR rule`; and its `## See also`
- Modify: `docs/graphql.md` — a new section before `## Limitations`; and its `## See also`
- Modify: `README.md` — the table of contents; a new `## Schema Versioning` section after `## GraphQL API`; the CLI Reference table; `### Delivered in v2` and `### Planned for v2+`
- Modify: `packages/create-manguito/src/templates/README.md.template`
- Create: `.changeset/create-manguito-versioning-readme.md`

**Interfaces:**
- Consumes: the command names and messages from Tasks 2 and 3. The guide quotes them, so read `packages/cli/src/commands/version.ts` once before writing, and correct any quoted output that differs.
- Produces: `docs/schema-versioning.md`, which Task 5's index and ADRs link to.

**Accuracy rule for this task:** every behavioural claim below was checked against the code on 2026-10-05. If you find one false while writing, do not soften it. Correct it to what the code does, and list the correction in your report.

- [ ] **Step 1: Write the guide**

Create `docs/schema-versioning.md` with exactly this content:

````markdown
# Schema versioning

Change your schema without breaking the consumers already reading your API.
Each **version** keeps serving the shape it had when you created it, from the
same database rows, while your working schema moves on.

> Versioning needs no setup. A new project is already **v1**: its content is
> served at `/api/v1/...` as well as `/api/...`. You only act when you are
> about to make a change an existing consumer would notice.

---

## Concepts

- **Working schema**: the files under `schemas/` that you edit. It is always the
  newest version, served at its own path and at the unversioned path.
- **Live version**: any version being served. That is every snapshot under
  `schemas/versions/` plus the working schema.
- **Creating a version** (`manguito version:create`) freezes the working schema
  into `schemas/versions/vN/`. From then on `/api/vN/...` keeps serving that
  shape, and the working schema becomes `v(N+1)`.
- **Retiring a version** (`manguito version:retire vN`) deletes its snapshot and
  stops serving it.

A version is a **contract about field names and which fields exist**, not a
copy of your data. Every version reads the same rows; it just presents them
under the names that version used.

Commit `schemas/versions/`. The snapshots in it *are* the live versions.
Deleting a directory by hand retires that version just as `version:retire` does.

## The everyday flow

1. Edit your schema as usual. Additions are safe: a new field or type does
   not disturb older versions.
2. Before a change an existing consumer would notice (a rename, a removal),
   run `manguito version:create`. Your current shape is frozen as the next
   version, and consumers pinned to it keep it.
3. Make the change in the working schema, using the declarations below.
4. When nobody reads an old version any more, `manguito version:retire vN`.

`manguito version:list` shows what you are serving at any point:

```
Live versions (3):
  v1  /api/v1  1 renamed, 1 removed, 1 added since
  v2  /api/v2  identical to current
  v3  /api/v3  current — also /api
```

## Renaming a field

Change the field's `name` and declare its `column` as the name it had before:

```json
{ "name": "heading", "column": "title", "label": "Heading", "type": "text/plain", "required": true }
```

A field's **column** is where its value is stored. It defaults to `name`, so
before the rename the column was `title`. Declaring it keeps the data where it
is: the working schema serves the value as `heading`, while every version
created before the rename still serves it as `title`.

> **Always declare `column` when you rename.** Changing `name` alone changes
> the storage column too. While a version still exposes the old column,
> `manguito build` refuses it (`VERSION_COLUMN_MISSING`). Before you have
> created any version, nothing stops it:
> - `manguito dev` drops the old column and its data immediately.
> - `manguito migrate` has to ask drizzle-kit whether this is a rename. Run
>   without a terminal (in CI, for example), drizzle-kit cannot ask, writes
>   **no migration**, and still exits successfully.
>
> Declaring `column` avoids the question entirely.

## Removing a field

While any live version still exposes a field, mark it removed instead of
deleting it:

```json
{ "name": "summary", "label": "Summary", "type": "text/plain", "required": false, "removed": true, "fallback": "" }
```

- **`removed: true`** keeps the column in the database for older versions.
  The working schema, its API and the admin panel stop exposing the field.
- **`required` must be `false`.** Nothing writes a removed field any more
  (`TOMBSTONE_REQUIRED`).
- **`fallback`** is optional. Older versions serve it in place of `null` for
  rows created after the removal. It replaces only `null`; `0`, `""` and
  `false` are real values and are served as stored. It is valid only on a removed
  field (`FALLBACK_WITHOUT_TOMBSTONE`).

Older versions keep serving the value each existing row had when you removed
the field. Nothing writes it any more, so for rows created afterwards they
serve the `fallback`. A live version is a supported contract, not a
permanently faithful one.

Once no live version exposes the column (you retired the last one that did),
delete the field. Until you do, `manguito validate` and `manguito build` fail
(`ORPHANED_TOMBSTONE`). `version:retire` names the fields to delete.

## What is not versioned

These follow the working schema on every version:

- **Paragraph types.** A version serves paragraph blocks in their current shape.
- **Programmatic fields.** Their names are the same on every version. A
  resolver always reads the record in the **current** field names
  (`ctx.get('heading')`, never `ctx.get('title')`), on every version and both
  APIs, so you write it once.
- **Many-to-many references and enum definitions.**

A `paragraph`, `programmatic` or many-to-many `reference` field has no storage
column of its own, so `column` and `removed` are rejected on it
(`UNRENAMEABLE_FIELD_KIND`). To rename one, retire every version that exposes
it first.

Changing a field's **type** while a live version exposes it is also refused
(`FIELD_TYPE_CHANGED_WHILE_LIVE`): one column cannot hold two types. Add a new
field with a new column instead, or retire the version first.

The admin panel always works on the working schema.

## REST

| Path | Serves |
| --- | --- |
| `/api/vN/<base path>` | version `vN`, for every live `vN` |
| `/api/<base path>` | the working schema |

The prefix is your configured `api.prefix`. Media routes and the OpenAPI
document are not versioned; one OpenAPI document describes every live version.

**Headers.**
- **An older live version** answers with `Deprecation: true` and a
  `Link: <...>; rel="successor-version"` header pointing at the current
  version.
- **The unversioned path** carries the same two headers once more than one
  version is live, plus a `Warning: 299` explaining that it will move when a
  new version is created.
- **The current version's own path** carries none.

**Versions not being served.**
- A retired version answers **410** with `VERSION_RETIRED`.
- A version that never existed answers **404** with `VERSION_NOT_FOUND`.
- Both name the live versions.

## GraphQL

With GraphQL enabled, each live version gets its own schema at
`/graphql/vN`, and `/graphql` serves the working schema. A field a version
still exposes but the working schema has renamed or removed is marked
`@deprecated` in that version's schema, naming what replaced it.

A request for a retired or unknown version answers HTTP 200 with a GraphQL
error. Its `extensions.code` is `VERSION_RETIRED` or `VERSION_UNKNOWN`, and it
lists the live versions. GraphQL clients show errors in a 200 response
readably, but report a 4xx as an opaque network failure.

## Commands

| Command | What it does |
| --- | --- |
| `manguito version:list` | Lists live versions, oldest first, with how far each is behind the working schema. Writes nothing. |
| `manguito version:diff` | Shows what `version:create` would freeze, field by field. Writes nothing. |
| `manguito version:create` | Freezes the working schema as the next version. Refuses if no column changed since the last version. `--yes` skips the confirmation. |
| `manguito version:retire vN` | Deletes the `vN` snapshot after confirming, and lists any removed fields you must then delete. Refuses to retire the newest snapshot, because the working schema's number is derived from it. |

`manguito version:cut` is the old name of `version:create`. It still works,
prints a deprecation notice, and will be removed in a future release.

`manguito validate` checks every version along with your schema, so run it
before `build` or in CI.

> **Retiring in development is immediate.** `manguito dev` applies schema
> changes with `drizzle-kit push`, which drops columns at once. Once a retired
> version's removed fields are deleted, their columns, and that data, are
> gone. In production, `manguito migrate` generates a reviewable migration
> and asks before dropping anything.

## Validation errors

| Code | Meaning |
| --- | --- |
| `VERSION_COLUMN_MISSING` | A live version exposes a column the working schema no longer has. Keep it as a `removed` field, or retire that version. |
| `FIELD_TYPE_CHANGED_WHILE_LIVE` | A live version exposes this column with a different type. |
| `ORPHANED_TOMBSTONE` | A `removed` field's column is exposed by no live version. Delete the field. |
| `VERSION_SNAPSHOT_INVALID` | A snapshot under `schemas/versions/` does not parse. |
| `DUPLICATE_COLUMN` | Two fields resolve to the same column, often a half-finished rename. |
| `TOMBSTONE_REQUIRED` | A `removed` field is also `required`. |
| `FALLBACK_WITHOUT_TOMBSTONE` | A `fallback` on a field that is not `removed`. |
| `UNRENAMEABLE_FIELD_KIND` | `column` or `removed` on a field with no storage column. |

## Known limitations

- **Paragraph types are not versioned** (above). `version:diff` still lists
  paragraph field changes, but no version serves them differently.
- **One OpenAPI document** describes every live version, so a client generated
  from it sees more than one pinned version exposes.
- **No support window.** Nothing limits how many versions are live or for how
  long. `version:list` shows the count; the policy is yours.

## See also

- [`schema-authoring.md`](./schema-authoring.md): field properties, including
  `column`, `removed` and `fallback`.
- [`graphql.md`](./graphql.md): the GraphQL API.
- [`programmatic-fields.md`](./programmatic-fields.md): resolvers and `ctx.get`.
- [`v2/schema-versioning.md`](./v2/schema-versioning.md): the design history and decision records.
````

The guide links `./v2/schema-versioning.md`, which Task 5 creates. Step 7's link check therefore reports that one link as unresolved until Task 5 lands. That failure is expected, and it is the only one allowed.

Before moving on, check four claims against the code and correct the guide if any is wrong:
- **Fallback:** `fallback` replaces only `null`/`undefined`. See `projectRow` in `packages/api/src/projector.ts`.
- **The unversioned-path headers:** see `deprecationHeaders` in `packages/api/src/versions.ts`.
- **GraphQL `@deprecated`:** it names what replaced a field. Grep `deprecationReason` in `packages/api/src/graphql/version-view.ts`.
- **`version:retire`:** it refuses the newest snapshot. See `runVersionRetire`.

- [ ] **Step 2: Document the field properties in the authoring guide**

In `docs/schema-authoring.md`, insert directly after the line `That's 13 field types in total.`:

```markdown

### Renaming and removing fields

Three optional properties apply to any field that has a storage column. That
is every type except `paragraph`, `programmatic` and many-to-many `reference`:

| Property | Meaning |
| --- | --- |
| `column` | The storage column. Defaults to `name`. Declare it when you rename a field, so the data stays where it is. |
| `removed` | `true` keeps the column for older API versions while this version stops exposing the field. Requires `required: false`. |
| `fallback` | Served in place of `null` by older versions for rows created after the removal. Only with `removed: true`. |

See [`schema-versioning.md`](./schema-versioning.md) for when and how to use them.
```

In its `## See also` list, add as the last item:

```markdown
- [`schema-versioning.md`](./schema-versioning.md) — renaming and removing
  fields without breaking existing API consumers.
```

- [ ] **Step 3: Add the versioned endpoints to the GraphQL guide**

In `docs/graphql.md`, insert directly before `## Limitations`:

```markdown
## Versioned endpoints

When your project has created schema versions, each live version gets its own
GraphQL schema at `/graphql/vN`, built from that version's field names.
`/graphql` serves the working schema. A field a version still exposes, but the
working schema has renamed or removed, is marked `@deprecated` there. A
request for a retired or unknown version answers HTTP 200 with a GraphQL error
whose `extensions.code` is `VERSION_RETIRED` or `VERSION_UNKNOWN`.

Programmatic resolvers read the current field names on every endpoint. See
[`schema-versioning.md`](./schema-versioning.md).

---
```

Check the separator style around `## Limitations` first. If sections in that file are not separated by `---`, drop the trailing `---`. In its `## See also`, add a `schema-versioning.md` item in the same style as the other items.

- [ ] **Step 4: Update the README**

In `README.md`:

1. In `## Table of Contents`, add `- [Schema Versioning](#schema-versioning)` directly after the `GraphQL API` entry.
2. Directly before `## CLI Reference`, and after the `---` that closes the GraphQL section, insert:

   ````markdown
   ## Schema Versioning

   Rename and remove fields without breaking the consumers already reading your
   API. Every project starts as **v1**: its content is served at `/api/v1/...`
   as well as `/api/...`. Before a change an existing consumer would notice, freeze the
   current shape:

   ```bash
   manguito version:create   # schemas/versions/v1/ — /api/v1 keeps this shape
   ```

   Then rename with a declared `column`, so the data stays where it is:

   ```json
   { "name": "heading", "column": "title", "label": "Heading", "type": "text/plain", "required": true }
   ```

   `/api/v1/...` keeps serving `title`, the working schema serves `heading`, and
   both read the same rows. The same holds on GraphQL at `/graphql/v1`.

   → See [docs/schema-versioning.md](docs/schema-versioning.md) for the full guide.

   ---

   ````

   The block above is wrapped in a four-backtick fence because it contains code blocks of its own. Paste only what is inside it.

3. In the CLI Reference table, insert these rows directly after the `manguito validate` row:

   ```markdown
   | `manguito version:list` | `--env <path>` | List live API versions and how far each is behind |
   | `manguito version:diff` | `--env <path>` | Show what `version:create` would freeze |
   | `manguito version:create` | `--env`, `--yes` | Freeze the working schema as the next version |
   | `manguito version:retire <version>` | `--env`, `--yes` | Stop serving a version and delete its snapshot |
   ```

4. Under `### Delivered in v2`, add after the GraphQL line:

   ```markdown
   - Schema versioning with multi-version API routes — see [docs/schema-versioning.md](docs/schema-versioning.md)
   ```

5. Under `### Planned for v2+`, delete the line `- Schema versioning with multi-version API routes`.

- [ ] **Step 5: Update the scaffolder's README template**

In `packages/create-manguito/src/templates/README.md.template`:

1. Replace the line beginning `Other CLI commands (run via` with:

   ```markdown
   Other CLI commands (run via `pnpm exec manguito <command>`): `createsuperuser`, `users:promote`, `users:demote`, `migrate:status`, `version:list`, `version:diff`, `version:create`, `version:retire`.
   ```

2. In the project-structure tree, add directly after the `routes.json` line, keeping the tree's alignment:

   ```
   └── versions/         ← API versions, created by `version:create` — commit this
   ```

   Change the `└──` on the `routes.json` line to `├──` so the tree stays well formed.

3. Directly after the project-structure code block, add:

   ```markdown
   Your API is already versioned: it is served at `/api/v1/...` as well as
   `/api/...`. Before renaming or removing a field that clients use, run
   `pnpm exec manguito version:create`. See the
   [schema versioning guide](https://github.com/bobbykim89/manguito-cms/blob/master/docs/schema-versioning.md).
   ```

Then run `pnpm --filter @bobbykim/create-manguito test`. Its tests generate a project from these templates, so they confirm the template still renders. Expected: `10 passed`, unchanged.

- [ ] **Step 6: Add the scaffolder changeset**

Create `.changeset/create-manguito-versioning-readme.md`:

```markdown
---
'@bobbykim/create-manguito': patch
---

The generated README lists the `version:*` commands, shows `schemas/versions/`
in the project tree, and explains that a new project's API is already served as v1.
```

- [ ] **Step 7: Check links, then commit**

```bash
pnpm lint:plans docs/schema-versioning.md docs/schema-authoring.md docs/graphql.md README.md
```

Expected: one failure only, `docs/schema-versioning.md` → `./v2/schema-versioning.md`, which Task 5 creates. Any other unresolved link is a defect: fix it.

```bash
git add docs/schema-versioning.md docs/schema-authoring.md docs/graphql.md README.md packages/create-manguito/src/templates/README.md.template .changeset/create-manguito-versioning-readme.md
git commit -m "docs: document schema versioning for users

A guide to creating, renaming, removing and retiring, with the REST and
GraphQL contracts and every validation error. The authoring guide
documents column, removed and fallback; the README moves versioning to
delivered; the scaffolded README lists the version commands."
```

---

### Task 5: Design index, ADRs and glossaries

The umbrella design promised a design index and ADRs. ADR api/0011 now describes behaviour 2f removed. The glossaries still say "cut", and *Tombstone* calls finished work unimplemented.

**Files:**
- Create: `docs/v2/schema-versioning.md`
- Create: `docs/adr/api/0012-multi-version-public-api.md`
- Create: `docs/adr/core/0007-column-is-cross-version-identity.md`
- Modify: `docs/adr/api/0011-field-label-vs-storage-key.md` — three passages, quoted below
- Modify: `packages/core/CONTEXT.md`, `packages/api/CONTEXT.md`, `packages/cli/CONTEXT.md`

**Interfaces:**
- Consumes: Task 4's `docs/schema-versioning.md`, which the index and both ADRs link to.
- Produces: nothing code consumes.

**Accuracy rule:** as in Task 4. A claim you find false while writing gets corrected to what the code does, and listed in your report.

- [ ] **Step 1: Write the design index**

Create `docs/v2/schema-versioning.md`:

```markdown
# Schema Versioning — Design Index

**Status:** Delivered. Released across `@bobbykim/manguito-cms-core`, `-db`, `-api`
and `-cli` 0.5–0.7. User guide: [`../schema-versioning.md`](../schema-versioning.md).

Versioning lets a schema change without breaking the consumers already reading
the API. Each live version serves its own field names over the same rows; the
working schema is always the newest version.

## Design history

Read in order. Each spec records what it decided, what it deferred, and what it
found wrong in its predecessors.

| Sub-project | Spec | Decided |
|---|---|---|
| Umbrella | [schema-versioning-design](../superpowers/specs/2026-08-27-schema-versioning-design.md) | Version the contract, not the data. A snapshot directory's presence is the truth. The unversioned path resolves to latest, with deprecation headers. **Its rename log (`pending.json` / `history.json`) is superseded by the declarative model.** |
| Stage 1.5 | [nested-projection-and-sort-mapping-design](../superpowers/specs/2026-08-29-nested-projection-and-sort-mapping-design.md) | Projection recurses into nested rows; `sort_by` maps labels to columns. |
| 2a | [version-model-core-design](../superpowers/specs/2026-08-30-version-model-core-design.md) | Core computes the version model: live set, union and per-version projections. |
| 2a′ | [declarative-version-model-design](../superpowers/specs/2026-09-02-declarative-version-model-design.md) | A field *declares* its `column`; a removed field stays as a tombstone (`removed`, `fallback`). This replaces the rename log, so the union registry is the current registry. |
| 2b/2c | [cli-version-lifecycle-design](../superpowers/specs/2026-09-02-cli-version-lifecycle-design.md) | `version:diff`, `version:cut` (now `version:create`) and `version:retire`. |
| 2d | [versioned-rest-routes-design](../superpowers/specs/2026-09-03-versioned-rest-routes-design.md) | `/api/vN/*` per live version, deprecation headers, 410/404 for versions not served. |
| 2e | [graphql-versioning-design](../superpowers/specs/2026-09-21-graphql-versioning-design.md) | One GraphQL schema per live version at `/graphql/vN`, with `@deprecated` for renamed or removed fields. |
| 2f | [column-as-identity-design](../superpowers/specs/2026-10-01-column-as-identity-design.md) | The storage column is a field's identity inside the api too: relations resolve under it, the drop-set splits by key space, and resolvers read current's names. |
| Closeout | [versioning-closeout-design](../superpowers/specs/2026-10-05-versioning-closeout-design.md) | `version:create` and `version:list`; `validate` checks the version model; this index and the ADRs. |

## Decisions

- [ADR core/0007 — A field's storage column is its identity across versions](../adr/core/0007-column-is-cross-version-identity.md)
- [ADR api/0012 — Multi-version public API](../adr/api/0012-multi-version-public-api.md)
- [ADR api/0011 — A field's label and its storage key are separate](../adr/api/0011-field-label-vs-storage-key.md)
- [ADR db/0002 — Two-mode migrations](../adr/db/0002-two-mode-migrations.md): why retiring in `dev` drops columns immediately.

The umbrella design also promised an amendment to ADR core/0003 justifying a
"derived union registry". Under the declarative model there is none: the union
**is** the current registry, with tombstones kept in it. So there is nothing
to justify, and no amendment was written.

## Deferred

Each of these was deliberately left out. Each needs its own design if taken up.

- **Paragraph types are not versioned.** Their columns are not retained for older
  versions, projections do not cover them, and `version:diff` still lists
  paragraph field changes that no version serves differently.
- **Non-interactive migrations can do nothing silently.** When a rename does not
  declare `column`, `drizzle-kit generate` has to ask "rename or create?". With
  no TTY it errors, exits 0, and writes no migration. The user guide tells
  authors to always declare `column`; the tooling does not yet refuse.
- **One OpenAPI document** describes every live version.
- **Public taxonomy collections** ignore filter, sort and include, on both APIs.
- **`createGraphQLHandler` called directly**, without `createCmsApp` and with a
  version projection but no `currentFieldKeyMaps`, hands resolvers that
  version's names.
- **A union `/graphql`** exposing every live version's fields, and a `Sunset`
  header with a support window, are both deferred until someone asks.
- **A smoke test** that creates a version in `apps/sandbox` and exercises both
  route sets.
```

Before saving, check the release range "0.5–0.7" against the `CHANGELOG.md` files of core, db, api and cli. Correct it to the versions that actually carried versioning; this closeout's own release will be cli 0.7.

- [ ] **Step 2: Write ADR api/0012**

Create `docs/adr/api/0012-multi-version-public-api.md`:

```markdown
---
status: accepted
---

# The public API serves every live schema version, with the version in the path

A project's public read API is served once per **live version**: every snapshot under `schemas/versions/` plus the working schema. Content and taxonomy routes carry the version as a path segment (`/api/v1/blog`). The unversioned path (`/api/blog`) resolves to the current version. GraphQL gets one schema per live version at `/graphql/vN`, and `/graphql` serves the current one. Every version reads the same rows; a version differs only in the field names it uses and the fields it exposes, applied once at the response boundary through that version's field-key map ([ADR api/0011](./0011-field-label-vs-storage-key.md)).

**Deprecation is signalled on the version a consumer should leave, never on the one they should be on:**
- An older live version's responses carry `Deprecation: true` and a `Link: <…>; rel="successor-version"` header.
- The unversioned path carries both, plus a `Warning: 299` saying it floats, but only once more than one version is live. A project that has never created a version sees none of this.
- The current version's own path carries no deprecation headers.

**A version outside the live set** answers 410 `VERSION_RETIRED` when its number is below current's, and 404 `VERSION_NOT_FOUND` otherwise. Both use the standard envelope and name the live versions. GraphQL answers the same two conditions with HTTP 200 and a GraphQL error (`VERSION_RETIRED` / `VERSION_UNKNOWN`), because GraphQL clients surface a 4xx as an opaque network error.

**Rate limiting** keys exclude the version segment, so rotating versions cannot multiply a client's budget.

## Considered Options

- **Version in a header (`Accept-Version`) or a query parameter.** Rejected. The version would be invisible in logs, caches and copied URLs, and every cache would need to vary on it. The path makes the version part of the resource's identity.
- **One unversioned `/graphql`, with deprecated fields for anything an older REST version still exposes.** This was the umbrella design's plan. It was rejected in 2e: one schema cannot serve two names for one field without exposing both to every client, and a pinned GraphQL consumer then has nothing to pin to.
- **Per-version write paths.** Rejected. The admin API always follows the current schema, so retained columns go stale for rows written after a removal. Fallbacks make that explicit. A live version is a supported contract, not a permanently faithful one.

## Consequences

- Media routes and the OpenAPI document are not versioned. `MediaItem` is a fixed shape, so a version segment would duplicate identical routes. One OpenAPI document describes every live version, which over-describes a pinned consumer's contract.
- Programmatic resolvers read the record in the **current** field names on every version and both APIs. Only their computed values are merged into a version's response ([column-as-identity design](../../superpowers/specs/2026-10-01-column-as-identity-design.md)).
- The live set is derived from snapshot directories at build time and baked into the server, so nothing about versions is stored at runtime.
- User guide: [`docs/schema-versioning.md`](../../schema-versioning.md).
```

Before saving, confirm that rate-limit keys exclude the version segment: grep for the rate-limit key construction in `packages/api/src` (for example `grep -rn "rateLimit\|keyFor\|limitKey" packages/api/src --include=*.ts | grep -v __tests__`). If the code does not do this, delete that paragraph and say so in your report. Do **not** change code to make it true.

- [ ] **Step 3: Write ADR core/0007**

Create `docs/adr/core/0007-column-is-cross-version-identity.md`:

```markdown
---
status: accepted
---

# A field's storage column is its identity across versions

A field has three names: its `label` (shown in the admin panel), its `name` (the public API key, which may differ per version), and its **column** (`db_column.column_name`, where the value is stored). The column is the one that never changes. It defaults to `name` and is **declared** by the author with `column` when a field is renamed. Versions are compared, retained and projected by column. Two versions that expose the same column under different names are exposing one field.

A field removed from the working schema while an older version still exposes its column stays in the schema as a **tombstone**: `removed: true`, an optional `fallback`, and `required: false`. Tombstones are part of the current registry. So the registry db codegen consumes, the "union registry", is simply the current registry: nothing is merged from snapshots, and a column is retained exactly as long as a tombstone declares it.

Only fields with a storage column of their own participate. A `paragraph` field's association lives on the paragraph table (`parent_field`), and a many-to-many `reference` field's lives in a junction table whose name embeds the field name. Both keep their name as their identity, so `column` and `removed` on them are rejected (`UNRENAMEABLE_FIELD_KIND`).

## Considered Options

- **Derive the column from a rename log** (`pending.json` appended by renames, folded backwards per version). This was the umbrella design's mechanism, and it was rejected in the declarative redesign. The log drifted from the files it described, a snapshot could not be read without replaying history, and a rename was invisible in the schema file itself.
- **Rename the physical column on a schema rename.** Rejected. `drizzle-kit generate` cannot tell a rename from a drop-and-add without asking interactively, and the drop branch destroys exactly the data an older version still serves.
- **A general storage key on every field kind**, paragraph and many-to-many included. Rejected for now: it changes `parent_field` semantics and junction table naming, both already persisted in existing databases, for renameability on fields authors rarely rename.

## Consequences

- Core validates the declarations at parse time (`DUPLICATE_COLUMN`, `TOMBSTONE_REQUIRED`, `FALLBACK_WITHOUT_TOMBSTONE`, `UNRENAMEABLE_FIELD_KIND`) and the version model at build time (`VERSION_COLUMN_MISSING`, `FIELD_TYPE_CHANGED_WHILE_LIVE`, `ORPHANED_TOMBSTONE`, `VERSION_SNAPSHOT_INVALID`). `manguito validate` and `manguito build` run both.
- Retirement is two steps: delete the snapshot, then delete the tombstones no live version still needs (`ORPHANED_TOMBSTONE` names them). The next migration then drops their columns.
- Renaming a field without declaring `column` changes its column. While a live version exposes the old column that is refused. Before any version exists it is a plain column rename, which drizzle-kit can only complete interactively. The user guide tells authors to always declare `column`.
- The api treats the column as the internal identity of a field throughout, and applies a version's names once at the response boundary ([ADR api/0011](../api/0011-field-label-vs-storage-key.md)).
- User guide: [`docs/schema-versioning.md`](../../schema-versioning.md).
```

- [ ] **Step 4: Correct ADR api/0011**

In `docs/adr/api/0011-field-label-vs-storage-key.md`, make three replacements.

**(a)** In the paragraph beginning "The api package converts at exactly two boundaries", replace

```text
and it throws on construction if a field's label collides with another field's column,
```

with

```text
and it throws on construction if a field with no column of its own (a paragraph, many-to-many or programmatic field, whose name is written into the row as a key) is named after another field's column,
```

**(b)** In the paragraph beginning "GraphQL never calls `toLabels`", replace the final two sentences (from "The one row GraphQL does project" to the end of the paragraph) with:

```text
The one row GraphQL does project is the record handed to a programmatic resolver, because `ctx.get()` takes a field name. On both surfaces that record is built with the **current** version's field-key map, whatever version is being served, so a resolver written once against the current schema reads `ctx.get('title')` correctly on every version; only its computed values are merged into the served version's response.
```

**(c)** Replace the Consequences bullet that begins "Relation resolution deletes the raw FK key" with:

```text
- Relation resolution writes a resolved reference or media object **in place, under its storage column**, and never under the field's name. `toLabels` then carries it to whichever name the served version uses, like any scalar. An earlier version of this ADR moved the object to the field's name and deleted the column, which made a renamed relation vanish on every older version (fixed in the [column-as-identity design](../../superpowers/specs/2026-10-01-column-as-identity-design.md)).
- The field-key map keeps two drop-sets, one per key space: `droppedColumns` for reads (`toLabels`) and `droppedLabels` for writes (`toStorage`). A label and a column can be the same text, and one shared set let one strip the other's mapping. `toStorage` maps a live label first and then refuses any unmapped key in either set, so an admin write can never fill a removed field's retained column.
```

Also replace the bullet beginning "Relation resolution is idempotent. Because it consumes the raw FK (and deletes the FK key outright" with:

```text
- Relation resolution is idempotent. Reference and junction targets are cached by `table:id`, and the GraphQL dataloaders do not memoize by parent identity, so the same row object can be visited twice. `needsFkResolution` sees an already-resolved object under the column and skips it, so a second pass is a no-op.
```

Confirm each target sentence exists before replacing it: `grep -n "throws on construction\|The one row GraphQL\|Relation resolution deletes\|Relation resolution is idempotent" docs/adr/api/0011-field-label-vs-storage-key.md`.

- [ ] **Step 5: Glossaries**

**`packages/core/CONTEXT.md`**:
- Replace the whole `**Cut**:` entry (term, definition and `_Avoid_` line) with:

  ```markdown
  **Create (a version)**:
  Freezing the working schema as a named version. `version:create` copies the schema folders into `versions/vN/`, and the working schema becomes `v(N+1)`. There is **no sealing step**: nothing is appended anywhere, because renames and retention live on the fields themselves. Formerly called *cut*; `version:cut` remains as a deprecated alias.
  _Avoid_: cut (retired term), tag, release, freeze

  **Retire (a version)**:
  Deleting a version's snapshot so it is no longer served. The author then deletes the tombstones no remaining live version exposes (`ORPHANED_TOMBSTONE` names them), and the next migration drops their columns.
  _Avoid_: delete version, prune, sunset
  ```

- In the `**Tombstone**:` entry, replace the sentence beginning "Excluding it from the api and the admin panel is an obligation, not yet implemented" (through the end of that sentence, including its parenthetical) with: `Excluded from the api's responses and writes and from the admin panel's schema.`
- Directly after the `**Tombstone**:` entry, add:

  ```markdown
  **Retained column**:
  A column kept in the database for an older live version after the working schema stopped exposing it: the column a tombstone declares. Older versions read it; nothing writes it, so rows created after the removal hold null there, which a fallback can replace.
  _Avoid_: legacy column, orphan column
  ```

- In the `**Snapshot**:` entry, replace "never edited after being cut" with "never edited after being created".

**`packages/api/CONTEXT.md`**, directly before `**Versioned surface**:`, add:

```markdown
**Live version**:
A version currently served: every snapshot under `schemas/versions/vN/` plus the working schema, which is also served at the [[unversioned-path]]. Defined in core's glossary; the api receives the live set baked into the [[baked-version-model]].
_Avoid_: active version, supported version

**Retained column**:
A column the working schema no longer exposes but an older live version still serves, kept by a tombstone (see core's glossary). The api drops it from current's reads and refuses it on writes.
_Avoid_: legacy column
```

Match the `[[...]]` link style to the file's existing cross-references. If it writes `[[baked-version-model]]`, keep that exact slug form.

**`packages/cli/CONTEXT.md`**: replace the whole `**version:cut**:` entry with:

```markdown
**version:create**:
Freezes the working schema as a new version: copies the four schema type folders into `schemas/versions/vN/`. `roles.json` and `routes.json` are excluded, since they live at the schema root rather than in a type folder. Core assembles every snapshot with *current's* roles and routes, because neither is versioned. Refuses when no column was added, renamed, tombstoned or restored since the last version. A change confined to paragraph, programmatic, many-to-many or enum definitions needs no new version, since none of them appear in a version's served contract. Otherwise it prints the change report and the live set the write commits you to (on a first run, also what happens to the URLs), confirms, writes to a `.vN.tmp` staging directory, and does one atomic rename into place, so a partial snapshot is impossible. `version:cut` is a hidden, deprecated alias that warns on stderr.
_Avoid_: cut (retired term), freeze (as command name), tag, release

**version:list**:
Read-only. Lists every live version oldest first, with its REST path and how many fields have been renamed, removed, added or restored since. The comparison is the same column-keyed one `version:diff` uses, against the working schema.
_Avoid_: status, versions
```

In the same file, in the `**version:diff**:` entry, replace "what cutting would freeze" with "what `version:create` would freeze".

- [ ] **Step 6: Check links and wording, then commit**

```bash
pnpm lint:plans docs/v2/schema-versioning.md docs/adr/api/0012-multi-version-public-api.md docs/adr/core/0007-column-is-cross-version-identity.md docs/adr/api/0011-field-label-vs-storage-key.md docs/schema-versioning.md
grep -n -i "\bcut\b" packages/core/CONTEXT.md packages/api/CONTEXT.md packages/cli/CONTEXT.md
```

Expected:
- The link check passes. Task 4's one expected failure now resolves, because this task created its target.
- The grep shows "cut" only where it names the retired term or the deprecated alias.

```bash
git add docs/v2/schema-versioning.md docs/adr packages/core/CONTEXT.md packages/api/CONTEXT.md packages/cli/CONTEXT.md
git commit -m "docs: record the schema versioning decisions

A design index for the 2a-2f specs and what each deferred; ADRs for the
multi-version public API and for the column as a field's identity; ADR
api/0011 corrected for 2f; and the glossaries renamed from cut to create."
```
