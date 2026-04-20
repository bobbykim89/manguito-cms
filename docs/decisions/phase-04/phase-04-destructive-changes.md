# Decision — Destructive Change Scanner

> Defines the SQL patterns the scanner detects, the return shape, and implementation approach.

---

## Detected Patterns

The scanner checks generated `.sql` files for three categories of destructive SQL operations — ones that can cause permanent, unrecoverable data loss.

| Pattern enum | SQL match (case-insensitive) | Example |
| ------------ | ---------------------------- | ------- |
| `DROP_COLUMN` | `DROP COLUMN` | `ALTER TABLE "blog_post" DROP COLUMN "summary"` |
| `DROP_TABLE` | `DROP TABLE` | `DROP TABLE "paragraph_photo_card"` |
| `ALTER_COLUMN_TYPE` | `ALTER COLUMN ... TYPE` | `ALTER TABLE "blog_post" ALTER COLUMN "price" TYPE integer` |

Other `ALTER TABLE` operations are not flagged — adding columns, adding constraints, and renaming tables are non-destructive.

---

## Return Shape

```ts
export type DestructiveOperation = {
  file: string        // filename only e.g. '0004_update_blog_post.sql'
  operation: string   // human-readable description for CLI output
  pattern: 'DROP_COLUMN' | 'DROP_TABLE' | 'ALTER_COLUMN_TYPE'
}

export type ScanResult = {
  hasDestructiveOperations: boolean
  operations: DestructiveOperation[]
}
```

The `operation` string is formatted for direct use in CLI warning output:

```
DROP COLUMN blog_post.summary
DROP TABLE paragraph_photo_card
ALTER COLUMN blog_post.price TYPE integer
```

Table and column names are extracted from the SQL line and stripped of quotes for readability.

---

## Implementation Approach

The scanner reads each file as plain text and processes it line by line. Drizzle Kit's generated SQL follows consistent formatting, making line-by-line string matching reliable — a full SQL parser is not required.

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'

export function scanMigrationFiles(filePaths: string[]): ScanResult {
  const operations: DestructiveOperation[] = []

  for (const filePath of filePaths) {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const filename = path.basename(filePath)

    for (const line of lines) {
      const upper = line.trim().toUpperCase()

      if (upper.includes('DROP COLUMN')) {
        operations.push({
          file: filename,
          operation: formatDropColumn(line),
          pattern: 'DROP_COLUMN',
        })
      } else if (upper.includes('DROP TABLE')) {
        operations.push({
          file: filename,
          operation: formatDropTable(line),
          pattern: 'DROP_TABLE',
        })
      } else if (upper.includes('ALTER COLUMN') && upper.includes(' TYPE ')) {
        operations.push({
          file: filename,
          operation: formatAlterColumnType(line),
          pattern: 'ALTER_COLUMN_TYPE',
        })
      }
    }
  }

  return {
    hasDestructiveOperations: operations.length > 0,
    operations,
  }
}
```

---

## Formatting Helpers

The `format*` helpers extract table/column names from the matched SQL line and produce the human-readable `operation` string. They strip double quotes from identifiers.

```ts
// 'ALTER TABLE "blog_post" DROP COLUMN "summary"'
// → 'DROP COLUMN blog_post.summary'
function formatDropColumn(line: string): string { ... }

// 'DROP TABLE "paragraph_photo_card"'
// → 'DROP TABLE paragraph_photo_card'
function formatDropTable(line: string): string { ... }

// 'ALTER TABLE "blog_post" ALTER COLUMN "price" TYPE integer'
// → 'ALTER COLUMN blog_post.price TYPE integer'
function formatAlterColumnType(line: string): string { ... }
```

If a line matches the pattern but name extraction fails (unexpected formatting), fall back to returning the raw trimmed line as the `operation` string rather than throwing.

---

## What the Scanner Does Not Do

- Does not connect to the DB
- Does not call `generateMigration` or `applyMigrations`
- Does not display warnings or prompts — that is Phase 9 CLI responsibility
- Does not decide whether to proceed — it returns findings only
- Does not scan the entire `./migrations/` history — only the files passed to it (newly generated files in the current run)

---

## CLI Usage (Phase 9 reference)

The CLI calls the scanner after `generateMigration` returns the list of newly generated file paths:

```ts
// Phase 9 — manguito migrate flow (reference only)
const generatedFiles = await generateMigration(configPath)
const scanResult = scanMigrationFiles(generatedFiles)

if (scanResult.hasDestructiveOperations) {
  // print warning, prompt for confirmation (or skip if --force)
}

await applyMigrations(configPath, db, options)
```

Full CLI behavior — warning format, `--force` flag, confirmation prompt — is specified in [phase-09-migrate-command.md](../phase-09/phase-09-migrate-command.md).
