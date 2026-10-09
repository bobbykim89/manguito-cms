---
"@bobbykim/manguito-cms-core": minor
---

Add `relationCardinality`, the single rule for whether a relation field holds one item or a list, also published browser-safe as `@bobbykim/manguito-cms-core/cardinality`. Add `findSchemaDeprecations`; `one-to-many` on a reference is now deprecated (it holds one item, like `one-to-one`).

**Breaking:** a required single reference's foreign key is now `ON DELETE RESTRICT` (it was `SET NULL`, which Postgres could never honour on a `NOT NULL` column). Run `manguito migrate` to apply it.
