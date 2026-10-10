---
"@bobbykim/manguito-cms-db": patch
---

Schema codegen now creates the link table for a many-to-many field on a taxonomy type, not only on a content type. Before, such a field had no table, so its links were never stored. After upgrading, run `manguito migrate` to create the missing tables; the migration only adds tables.
