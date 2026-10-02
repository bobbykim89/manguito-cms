---
'@bobbykim/manguito-cms-api': minor
---

Treat a field's storage column as its identity, so older API versions serve
renamed fields correctly.

- A media field renamed since an older version was cut is now served on that
  version, resolved, under that version's name. It used to be missing from the
  response.
- A reference renamed since an older version was cut can now be `?include=`d on
  that version, under that version's name. It used to return 400 whichever name
  was used.
- A removed (tombstoned) reference or media field that an older live version
  still exposes can now be `?include=`d on that version. It stays refused on
  the current version.
- A version whose field name equals a different field's name or column no
  longer serves that other field's data.
- Two schema shapes that used to stop the app at startup now start and map
  correctly: a field named after another field's column, and a live field
  named after a removed field's retained column.
- Programmatic resolvers now read a record in the current schema's field names
  on every version, over both REST and GraphQL, so a value cached for one
  version is valid on all of them. On an older version, `ctx.get('<current
  name>')` used to be `undefined`.
- GraphQL `filter: { createdAt: … }` and `updatedAt` now work. They used to
  fail with an internal error.
- In REST responses, a relation whose storage column differs from its field
  name now appears at its column's position in the object, not at the end.
  Keys and values are unchanged.
