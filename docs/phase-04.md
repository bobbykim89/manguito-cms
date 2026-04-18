# Phase 4 — Destructive Change Scanner

> A single new DB module function that scans generated migration SQL for destructive operations before they are applied.

This phase adds one focused piece of functionality to `packages/db`: a scanner that reads generated `.sql` migration files and identifies operations that could cause permanent data loss. The scanner is called by the CLI (`manguito migrate`) in Phase 9 — Phase 4 defines what it does and what it returns.

**Done when:** `scanMigrationFiles` correctly identifies all destructive SQL patterns across a set of generated migration files and returns a structured result. Unit tests cover all detected patterns and the no-destructive-operations case.

---

## Decisions Made

| Topic | Detail doc |
| ----- | ---------- |
| Scanner patterns, return shape, implementation notes | [phase-04-destructive-changes.md](./decisions/phase-04/phase-04-destructive-changes.md) |

---

## Where This Fits

```
Phase 3 — migration runner produces:
  runDevMigration()
  generateMigration()      ← generates SQL files
  applyMigrations()
  getMigrationStatus()

Phase 4 — adds:
  scanMigrationFiles()     ← scans generated SQL before apply

Phase 9 — CLI orchestrates:
  manguito migrate → generateMigration() → scanMigrationFiles() → applyMigrations()
```

The scanner sits between `generateMigration` and `applyMigrations` in the production migration flow. It does not call either — it receives a list of file paths and returns findings. The CLI decides what to do with those findings.

---

## Package Structure Addition

```
packages/db/src/
├── migrations/
│   ├── index.ts        ← existing — runner functions
│   └── scanner.ts      ← new — scanMigrationFiles
```

---

## Function Signature

```ts
export type DestructiveOperation = {
  file: string        // migration filename e.g. '0004_update_blog_post.sql'
  operation: string   // human-readable description e.g. 'DROP COLUMN blog_post.summary'
  pattern: 'DROP_COLUMN' | 'DROP_TABLE' | 'ALTER_COLUMN_TYPE'
}

export type ScanResult = {
  hasDestructiveOperations: boolean
  operations: DestructiveOperation[]
}

export function scanMigrationFiles(filePaths: string[]): ScanResult
```

`scanMigrationFiles` is a pure synchronous function — it reads files from disk and returns a result. No DB connection required.

---

## Public Exports Addition

Add to `packages/db/src/index.ts`:

```ts
export { scanMigrationFiles } from './migrations/scanner'
export type { ScanResult, DestructiveOperation } from './migrations/scanner'
```

---

## Developer Checklist

- [ ] Create `packages/db/src/migrations/scanner.ts`
- [ ] `scanMigrationFiles` reads each file path and scans contents
- [ ] Detects `DROP COLUMN` pattern — extracts table and column name
- [ ] Detects `DROP TABLE` pattern — extracts table name
- [ ] Detects `ALTER COLUMN ... TYPE` pattern — extracts table and column name
- [ ] Pattern matching is case-insensitive
- [ ] Returns `hasDestructiveOperations: false` and empty array when nothing found
- [ ] Returns structured `DestructiveOperation[]` with file, operation string, and pattern enum
- [ ] Export `scanMigrationFiles`, `ScanResult`, `DestructiveOperation` from `index.ts`

---

## Tests

- [ ] Unit: no destructive operations — returns `{ hasDestructiveOperations: false, operations: [] }`
- [ ] Unit: `DROP COLUMN` detected — correct file, operation string, pattern
- [ ] Unit: `DROP TABLE` detected — correct file, operation string, pattern
- [ ] Unit: `ALTER COLUMN ... TYPE` detected — correct file, operation string, pattern
- [ ] Unit: multiple destructive operations in one file — all returned
- [ ] Unit: multiple files — operations correctly attributed to their source file
- [ ] Unit: mixed files — destructive and non-destructive in same batch

---

## Claude Code Checklist

- [ ] Read [phase-04-destructive-changes.md](./decisions/phase-04/phase-04-destructive-changes.md) before implementing `scanner.ts`
- [ ] `scanMigrationFiles` is pure and synchronous — no DB connection, no async
- [ ] Do not implement CLI output or confirmation prompts here — that is Phase 9's responsibility
- [ ] Scanner receives file paths and returns findings only — it does not decide what happens next
- [ ] All three destructive patterns must be detected — do not skip `ALTER COLUMN ... TYPE`
