---
"@bobbykim/manguito-cms-db": minor
---

Adds `previewMigration(configPath, migrationsFolder)`, which returns the migration `generateMigration` would write (each file's name and SQL) without writing it. drizzle-kit generates into a temporary copy of the migrations folder, through a temporary config that imports the real one and changes only `out`, so the real folder is never written to, even if the preview fails or is interrupted. Adds `scanMigrationSql`, the destructive-operation scan over SQL already in hand; `scanMigrationFiles` now uses it.
