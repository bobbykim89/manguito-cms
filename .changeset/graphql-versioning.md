---
'@bobbykim/manguito-cms-core': minor
'@bobbykim/manguito-cms-api': minor
---

Serve every live schema version over GraphQL.

Each live version gets its own schema at `/graphql/<version>`, built from that
version's projection: field names come from the labels that version exposes,
nullability from its own requiredness, and a field renamed or removed since
carries `@deprecated` naming what replaced it. `/graphql` is unchanged and
still floats to the current version, and a project that has not cut a version
sees no new endpoints.

`VersionProjection` gains `required` so each version states its own
nullability. Borrowing the current schema's flag would emit a non-null GraphQL
type over rows holding nulls and null out the whole parent object.

Also fixes two bugs on the GraphQL surface: tombstoned fields (`removed: true`)
were built into the schema and served their retained data, and the sort enum
offered `title` on types that have no field with that label, producing a 500
from SQL rather than a rejected query.

Two further fixes, both user-visible: a renamed media or reference field's
resolved object was discarded from the record handed to a programmatic
resolver on an older live version, so `ctx.get(...)` saw nothing where REST
presents a resolved object; and the field-key map's collision check falsely
rejected a field renamed back onto its own column's name while an intermediate
version was still live, making `createCmsApp` throw at startup for every
version at once.
