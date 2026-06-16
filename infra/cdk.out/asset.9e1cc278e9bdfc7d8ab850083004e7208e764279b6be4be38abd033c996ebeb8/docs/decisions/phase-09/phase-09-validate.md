# Decision — `manguito validate`

> Defines the validation command — what it checks, exit behavior, and intended use cases.

---

## Overview

`manguito validate` is a fast, read-only command that parses and validates all project configuration and schema files. It produces no artifacts, makes no DB connections, and exits non-zero on any error. Its primary use is as a pre-commit hook or CI pipeline lint step.

---

## What It Validates

1. **`manguito.config.ts`** — resolves without errors, all required fields present
2. **All schema files** (`schemas/content-types/`, `schemas/paragraph-types/`, `schemas/taxonomy-types/`) — Zod validation, cross-references between schemas valid, no circular references
3. **`roles.json`** — valid structure, required fields present, no duplicate `hierarchy_level` values
4. **`routes.json`** — valid structure, base paths well-formed, referenced content types exist in schemas

This is a superset of what `manguito build` validates in its parse step — validate covers config files that build also reads, plus the same schema validation.

---

## Flags

```
manguito validate                  # validate everything
manguito validate --env <file>     # load env file before config resolution
```

`--env` is accepted because `manguito.config.ts` may read from `process.env`. See [phase-09-env-flag.md](./phase-09-env-flag.md).

No `--watch` flag. In `manguito dev`, the file watcher already re-parses and reports errors on every schema save. `validate` is a one-shot command.

---

## Exit Behavior

- **Exit `0`** — all files valid, no errors found
- **Exit `1`** — one or more errors found

All errors are collected and listed before exiting — the developer sees the full picture, not just the first failure.

---

## Success Output

```
✔ Config valid
✔ Schemas valid (3 content types, 2 paragraph types, 1 taxonomy type)
✔ roles.json valid
✔ routes.json valid

No errors found.
```

---

## Error Output

```
✖ Validation errors:

  manguito.config.ts
    Missing required field: api.storage

  schemas/content-types/blog-post.json
    Line 12 — unknown field type "richtext" (did you mean "text/rich"?)

  schemas/content-types/article.json
    Line 8 — references unknown content type "author_profile"

  routes.json
    Line 3 — references unknown content type "news_article"

4 errors found. Fix the above and run `manguito validate` again.
```

---

## Use Cases

**Pre-commit hook** — fast check before committing schema changes:
```bash
# .husky/pre-commit
manguito validate
```

**CI pipeline** — lint step before build:
```yaml
- run: manguito validate
- run: manguito build
```

**Quick sanity check** — during schema authoring without starting the full dev server.

---

## What It Does Not Do

- Does not run codegen
- Does not connect to the DB
- Does not check migration state
- Does not watch for file changes
