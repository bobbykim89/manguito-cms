---
"@bobbykim/manguito-cms-db": minor
---

Adds `previewMigration(configPath, migrationsFolder)`, which returns the migration `generateMigration` would write (each file's name and SQL) and then restores the migrations folder exactly as it was, even when generation fails part-way. Adds `scanMigrationSql`, the destructive-operation scan over SQL already in hand; `scanMigrationFiles` now uses it.
