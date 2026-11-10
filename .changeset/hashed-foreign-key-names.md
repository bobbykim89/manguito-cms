---
'@bobbykim/manguito-cms-db': patch
---

Foreign keys whose names pass 63 characters now get a hashed 63-character name, so the dev server's push stops re-planning them on every run (#88). An existing project's long foreign keys are renamed once, on its next dev push or in its next generated migration.

Schemas that failed with a foreign-key `CONSTRAINT_NAME_COLLISION` (two long reference columns, or a long link table) now pass; `findConstraintNameCollisions` checks the hashed names.

`ensureLinkConstraints` reads all link tables in one query (#89).
