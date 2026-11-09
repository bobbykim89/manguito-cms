---
'@bobbykim/manguito-cms-db': minor
---

Every link table now gets a unique constraint on its (left, right) pair, so a list can no longer store the same link twice.

- **Production:** run `manguito migrate`. It generates the constraint, together with a clean-up that removes only repeated links, keeping the lowest-order copy of each, which is the one a read already shows. `migrate` rebuilds on its own after this upgrade, with no schema edit needed.
- **Development:** restart `manguito dev`. It removes the repeated links and adds the constraint directly, before its schema push.
- **Known limitation:** renaming a many-to-many field or its owner type in `dev` may show push's truncate question once; its default answer, "No", is safe.
- Schemas whose constraint names would collide in Postgres, which keeps only the first 63 characters of a name, are now refused before migration with `CONSTRAINT_NAME_COLLISION`, naming the rename that clears it, instead of failing in the migration. New exports: `findConstraintNameCollisions`, `foreignKeyName`, `linkUniqueName`, `linkDedupeSql`, `addLinkDedupe` and `ensureLinkConstraints`.
- A type with many-to-many fields `x` and `x_unique` is now refused with `CONSTRAINT_NAME_COLLISION`: `x`'s new unique constraint would take `x_unique`'s link table name, so its migration would fail. The message names the rename.
