---
"@bobbykim/manguito-cms-admin": minor
---

A `one-to-one` paragraph field is edited as a single item (add, edit, remove) instead of a list, and a deprecated `one-to-many` reference uses a single picker. Required for `@bobbykim/manguito-cms-api`'s new relation shapes.

**Requires `@bobbykim/manguito-cms-api` 0.8.0 or later. Upgrade the two packages together.** With an older api, this admin reads a `one-to-one` paragraph as empty and saves it as `null`, which the older api treats as an empty list and so deletes the stored items.
