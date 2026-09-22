---
'@bobbykim/manguito-cms-core': minor
'@bobbykim/manguito-cms-api': minor
---

Serve every live schema version over GraphQL.

Each live version gets its own schema at `/graphql/<version>`, built from that
version's projection: field names come from the labels that version exposes,
nullability from its own requiredness, and a field renamed or removed since
carries `@deprecated` naming what replaced it. `/graphql` still floats to the
current version — it is not a new route — but it is not byte-identical to
its pre-versioning behavior either: the two bug fixes below (tombstoned
fields, the sort enum) apply to it too. A project that has never cut a
version still gets `/graphql/v1` alongside `/graphql` — both serve the same,
single live version — the same way the REST surface already aliases an
unversioned project onto `v1`. **Re-run `manguito build` after upgrading** so
the baked version model carries the new `required` field.

`VersionProjection` gains `required` so each version states its own
nullability. Borrowing the current schema's flag would emit a non-null GraphQL
type over rows holding nulls and null out the whole parent object.

Also fixes two bugs on the GraphQL surface: tombstoned fields (`removed: true`)
were built into the schema and served their retained data, and the sort enum
offered `title` on types that have no field with that label — the field is
now excluded from the sort enum instead, so an attempt to sort by it is
rejected as an invalid sort field (masked by GraphQL's error handling as a
200 with an `INTERNAL_SERVER_ERROR`), rather than reaching SQL at all.

Two further fixes, both user-visible: a renamed media or reference field's
resolved object was discarded from the record handed to a programmatic
resolver on an older live version, so `ctx.get(...)` saw nothing where REST
presents a resolved object; and the field-key map's collision check falsely
rejected a field renamed back onto its own column's name while an intermediate
version was still live, making `createCmsApp` throw at startup for every
version at once.
