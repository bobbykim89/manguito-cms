---
'@bobbykim/manguito-cms-cli': minor
---

`manguito migrate` now rebuilds after a manguito upgrade, so codegen changes reach your migration without a schema edit.

- `manguito migrate` rebuilds when the installed manguito packages changed since the last build. `build` records their versions in `dist/generated/manguito-versions.json`.
- `manguito dev` adds link constraints before pushing the schema.
- Validation refuses schemas whose constraint names collide in Postgres.
