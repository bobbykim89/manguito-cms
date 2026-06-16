# Decision — CLI Testing Strategy

> Defines the testing approach for `@bobbykim/manguito-cms-cli` — what to test, how to test it, and what to skip.

---

## Philosophy

The CLI is orchestration — it calls functions from other packages and strings them together. Most real logic lives in `core`, `db`, and `api` which are already tested in Phase 7. However, there are failure modes that only appear at the orchestration level:

- Wrong step order in a command (e.g. seeder runs before migrations)
- A precondition check that does not actually stop execution
- The mtime skip logic deciding incorrectly whether to rebuild
- A guided error message pointing to the wrong command
- `--env` not loaded before config resolution

These are invisible to package-level unit tests. CLI-level tests catch them.

---

## Test Organization

```
packages/cli/
├── src/__tests__/          ← unit tests for utils/ pure functions
└── tests/                  ← integration tests for command handlers
```

Command handler functions are tested directly — not by invoking the binary as a subprocess. Dependencies (build runner, migration runner, DB connection, seeder, prompt adapter) are injected as mocks or test doubles. This is faster than subprocess testing and produces better error messages.

---

## PromptAdapter in Tests

All interactive commands accept a `PromptAdapter` parameter. Tests supply a simple object with pre-supplied values:

```ts
const mockPrompt: PromptAdapter = {
  input: async () => 'test@example.com',
  password: async () => 'SecurePass1!',
  confirm: async () => true,
  select: async () => 'editor',
}
```

No subprocess, no keystroke simulation, no fragile stdin mocking.

---

## Coverage Tiers

### Full Integration Tests (`tests/`) — command orchestration and guard rails

These commands have step ordering, conditional logic, or guard rails that are critical to get right:

**`migrate`**
- [ ] Correct step order: mtime check → build (if needed) → drizzle-kit generate → scanMigrationFiles → destructive warning → apply → seed
- [ ] mtime skip: schema files unchanged → build is skipped
- [ ] mtime trigger: schema files newer than artifacts → build runs
- [ ] No artifacts: build always runs
- [ ] Build failure stops execution — subsequent steps do not run
- [ ] Destructive ops found without `--force`: confirmation prompt shown
- [ ] Destructive ops found with `--force`: confirmation skipped, warning still printed
- [ ] `--status`: no build triggered, reads migration state only
- [ ] `--dry-run`: no writes to DB, preview output printed

**`start`**
- [ ] Scenario A: no migration table → blocked with guided error
- [ ] Scenario B: pending migrations exist → warning printed, server starts
- [ ] Scenario C: no pending migrations → clean start, no warnings

**`dev`**
- [ ] Full startup sequence executes in correct order
- [ ] First-admin prompt triggered when no admin user exists in DB
- [ ] First-admin prompt skipped when admin user already exists
- [ ] Schema parse error on startup → guided error, server does not start

**`createsuperuser`**
- [ ] Blocked if DB unreachable
- [ ] Blocked if users table does not exist → guided error pointing to migrate
- [ ] Blocked if no roles in DB → guided error pointing to migrate
- [ ] Re-prompts on invalid email format
- [ ] Re-prompts if passwords do not match
- [ ] Re-prompts if password fails validation rules
- [ ] Re-prompts if email already exists
- [ ] Creates user with highest-hierarchy role from DB lookup (not hardcoded "admin")

### Lighter Tests (`tests/`) — happy path + key failure case

**`build`**
- [ ] Succeeds with valid schemas → all codegen steps called in order
- [ ] Parse error → all errors listed, process exits 1

**`validate`**
- [ ] All files valid → exits 0
- [ ] Schema error → exits 1, all errors listed
- [ ] `roles.json` error → exits 1
- [ ] `routes.json` error → exits 1

**`users:promote`**
- [ ] Already-admin → warns and stops, no DB write
- [ ] User not found → guided error
- [ ] Success → role updated, success output printed

**`users:demote`**
- [ ] Last-admin guard → blocked with guided error
- [ ] Same role as current → warns and stops
- [ ] User not found → guided error
- [ ] Success → role updated, success output printed

**`init`**
- [ ] Non-empty directory → aborts with guided error, no files written
- [ ] Valid scaffold → correct files written to target directory
- [ ] Template variables substituted correctly in rendered files

### Unit Tests (`src/__tests__/`) — pure utility functions

**`utils/env.ts`**
- [ ] Loads env file when path provided
- [ ] Missing env file → guided error

**`utils/template.ts`**
- [ ] Replaces all known `{{variable}}` placeholders
- [ ] Unknown placeholders left as-is (not replaced with empty string)
- [ ] Multiple occurrences of same variable all replaced

**`utils/error.ts`**
- [ ] Error message formatted correctly for terminal
- [ ] Hint line included when error has hint, omitted when not

**Build mtime logic** (extracted pure function)
- [ ] Returns `rebuild: true` when schema file mtime is newer than artifact
- [ ] Returns `rebuild: false` when artifact is newer than all schema files
- [ ] Returns `rebuild: true` when artifact does not exist

---

## What to Skip

- Commander wiring and help text — Commander's responsibility, not ours
- `--env` flag mechanics — covered by `utils/env.ts` unit test
- Anything already tested in `core`, `db`, or `api` packages
- Vite and tsup compilation output — covered by those tools' own test suites

---

## Test Doubles Pattern

Command handler functions accept dependencies as parameters rather than importing them directly:

```ts
// commands/migrate.ts
type MigrateOptions = {
  env?: string
  force?: boolean
  dryRun?: boolean
  status?: boolean
}

type MigrateDeps = {
  buildRunner: () => Promise<Result<void, CmsError>>
  migrationRunner: MigrationRunner
  scanner: typeof scanMigrationFiles
  seeder: typeof seedSystemTables
  prompt: PromptAdapter
}

export async function runMigrate(
  options: MigrateOptions,
  deps: MigrateDeps
): Promise<Result<void, CmsError>>
```

The `register*(program)` function in the same file wires the real dependencies when called from `index.ts`. Tests supply mocks directly to `runMigrate`.

---

## Notes

- No snapshot tests for CLI output strings — too brittle for terminal formatting
- No subprocess / `execa` based tests — direct function call with injected mocks only
- DB is not required for command handler unit/integration tests — DB interactions are mocked at the repository level
