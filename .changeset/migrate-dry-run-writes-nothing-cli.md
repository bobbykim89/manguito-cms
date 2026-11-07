---
"@bobbykim/manguito-cms-cli": patch
---

`manguito migrate --dry-run` no longer writes migration files. It used to run drizzle-kit generate for real, leaving the new `.sql` file, its snapshot and a journal entry in `migrations/`, while printing that nothing was written. The dry run now previews without writing, and shows everything `migrate` would apply: migrations generated earlier but not yet applied, as well as the one it would generate now, with their SQL. It lists destructive operations without asking "Apply anyway?", since nothing is applied.

`manguito migrate` now checks every migration it is about to apply for destructive operations, not only the ones it generated in that run. A destructive migration left in `migrations/` by an earlier dry run used to be applied with no warning.
