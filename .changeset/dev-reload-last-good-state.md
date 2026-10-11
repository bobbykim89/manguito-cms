---
"@bobbykim/manguito-cms-cli": patch
---

`manguito dev` keeps running when an edit breaks something. A schema parse error (a typo in a schema file, roles.json or routes.json), a reference error, an invalid version model, or a resolver file that fails to import used to stop the dev server, or left its watcher dead. Now dev prints the error in full, with file and message, and keeps serving the last good version.

Startup and reload run the same checks, in the same order, before writing anything. A rejected edit no longer rewrites the `.manguito` files. At startup, an invalid version model is refused before the database is migrated. The exception is a failed drizzle-kit push, which still comes after the files are rewritten, because the push reads the new `schema.ts`.
