---
"@bobbykim/manguito-cms-cli": patch
---

`manguito validate`, `dev`, `build` and the `version:*` commands report two schema types or many-to-many fields that would share a database table (`TABLE_NAME_COLLISION`), and two field names that would share a column. Such a schema used to fail later with a confusing codegen or migration error.
