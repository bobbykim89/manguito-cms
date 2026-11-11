---
'@bobbykim/manguito-cms-db': patch
'@bobbykim/manguito-cms-admin': patch
---

Codegen quotes schema text safely (#96). An enum value holding an apostrophe, backtick, `${` or backslash no longer breaks the generated CHECK constraint or `schema.ts`. A field label or enum option holding a line break or a double quote no longer breaks the generated admin form.
