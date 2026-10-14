---
"@bobbykim/manguito-cms-cli": patch
---

`manguito migrate --dry-run` no longer writes migration files. It used to run drizzle-kit generate for real, leaving the new `.sql` file, its snapshot and a journal entry in `migrations/`, while printing that nothing was written; a following `manguito migrate` then generated nothing new. The dry run now previews the SQL and restores the folder. It also no longer asks "Apply anyway?" for destructive operations: it lists them, since nothing is applied.
