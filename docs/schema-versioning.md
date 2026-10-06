# Schema versioning

Change your schema without breaking the consumers already reading your API.
Each **version** keeps serving the shape it had when you created it, from the
same database rows, while your working schema moves on.

> Versioning needs no setup. A new project is already **v1**: its content is
> served at `/api/v1/...` as well as `/api/...`. You only act when you are
> about to make a change an existing consumer would notice.

---

## Concepts

- **Working schema**: the files under `schemas/` that you edit. It is always the
  newest version, served at its own path and at the unversioned path.
- **Live version**: any version being served. That is every snapshot under
  `schemas/versions/` plus the working schema.
- **Creating a version** (`manguito version:create`) freezes the working schema
  into `schemas/versions/vN/`. From then on `/api/vN/...` keeps serving that
  shape, and the working schema becomes `v(N+1)`.
- **Retiring a version** (`manguito version:retire vN`) deletes its snapshot and
  stops serving it.

A version is a **contract about field names and which fields exist**, not a
copy of your data. Every version reads the same rows; it just presents them
under the names that version used.

Consumers on the unversioned `/api/...` path follow the working schema and see
a change as soon as you make it, so move them to a pinned `/api/vN` path before
you change a field they use.

Commit `schemas/versions/`. The snapshots in it *are* the live versions.
Deleting a directory by hand retires that version, except the newest one:
deleting the newest snapshot renumbers the working schema onto its number,
which `version:retire` refuses to do.

## The everyday flow

1. Edit your schema as usual. Additions are safe: a new field or type does
   not disturb older versions.
2. Before a change an existing consumer would notice (a rename, a removal),
   run `manguito version:create`. Your current shape is frozen as the next
   version, and consumers pinned to it keep it.
3. Make the change in the working schema, using the declarations below.
4. When nobody reads an old version any more, `manguito version:retire vN`.

`manguito version:list` shows what you are serving at any point:

```
Live versions (3):
  v1  /api/v1  1 renamed, 1 removed, 1 added since
  v2  /api/v2  identical to current
  v3  /api/v3  current — also /api
```

## Renaming a field

Change the field's `name` and declare its `column` as the name it had before:

```json
{ "name": "heading", "column": "title", "label": "Heading", "type": "text/plain", "required": true }
```

A field's **column** is where its value is stored. It defaults to `name`, so
before the rename the column was `title`. Declaring it keeps the data where it
is: the working schema serves the value as `heading`, while every version
created before the rename still serves it as `title`.

> **Always declare `column` when you rename.** Changing `name` alone changes
> the storage column too. While a version still exposes the old column,
> `manguito build` refuses it (`VERSION_COLUMN_MISSING`). Before you have
> created any version, nothing stops it. drizzle-kit has to ask whether the
> new column is a rename or a new column, in both `manguito dev` and
> `manguito migrate`:
> - Answering "new column" drops the old column and its data.
> - Run without a terminal (in CI, for example), `manguito migrate` cannot
>   ask, writes **no migration**, and still exits successfully.
>
> Declaring `column` avoids the question entirely.

## Removing a field

While any live version still exposes a field, mark it removed instead of
deleting it:

```json
{ "name": "summary", "label": "Summary", "type": "text/plain", "required": false, "removed": true, "fallback": "" }
```

- **`removed: true`** keeps the column in the database for older versions.
  The working schema, its API and the admin panel stop exposing the field.
- **`required` must be `false`.** Nothing writes a removed field any more
  (`TOMBSTONE_REQUIRED`).
- **`fallback`** is optional. Older versions serve it in place of every `null`
  in the retained column: rows created after the removal, and any older row
  that was already `null`. It replaces only `null`; `0`, `""` and `false` are
  real values and are served as stored. It is valid only on a removed field
  (`FALLBACK_WITHOUT_TOMBSTONE`).

Older versions keep serving the value each existing row had when you removed
the field. Nothing writes it any more, so rows created afterwards serve the
`fallback` if one is declared, and `null` otherwise. A live version is a
supported contract, not a permanently faithful one.

Once no live version exposes the column (you retired the last one that did),
delete the field. Until you do, `manguito validate` and `manguito build` fail
(`ORPHANED_TOMBSTONE`). `version:retire` names the fields to delete.

## What is not versioned

These follow the working schema on every version:

- **Paragraph types.** A version serves paragraph blocks in their current shape.
- **Programmatic fields.** Their names are the same on every version. A
  resolver always reads the record in the **current** field names
  (`ctx.get('heading')`, never `ctx.get('title')`), on every version and both
  APIs, so you write it once.
- **Many-to-many references and enum definitions.**

A `paragraph`, `programmatic` or many-to-many `reference` field has no storage
column of its own, so `column` and `removed` are rejected on it
(`UNRENAMEABLE_FIELD_KIND`). Renaming such a field is not refused: it silently
renames the field on every version, because versions project only column-backed
fields. But the content stored under the old name is detached. Paragraph rows
are keyed by the field name, so existing blocks stop being served. A
many-to-many junction table's name embeds the field name, so a rename forces
drizzle-kit into a rename-or-create choice that can drop every association.
Renaming one of these fields therefore amounts to removing it and adding a new
one, and it is not supported. If older versions must keep the old name, retire
every version that exposes the field first, and expect to re-create the content.

Changing a field's **type** while a live version exposes it is also refused
(`FIELD_TYPE_CHANGED_WHILE_LIVE`): one column cannot hold two types. Add a new
field with a new column instead, or retire the version first.

The admin panel always works on the working schema.

## REST

| Path | Serves |
| --- | --- |
| `/api/vN/<base path>` | version `vN`, for every live `vN` |
| `/api/<base path>` | the working schema |

The prefix is your configured `api.prefix`. Media routes are not versioned. The
OpenAPI document is not versioned either: it lists only the unversioned paths
for the working schema's types, and no `/api/vN` paths.

**Headers.**
- **An older live version** answers with `Deprecation: true` and a
  `Link: <...>; rel="successor-version"` header pointing at the current
  version.
- **The unversioned path** carries the same two headers once more than one
  version is live, plus a `Warning: 299` explaining that it will move when a
  new version is created.
- **The current version's own path** carries none.

**Versions not being served.**
- A version number below the current one that is not live answers **410** with
  `VERSION_RETIRED`; one at or above the current version's answers **404** with
  `VERSION_NOT_FOUND`.
- Both name the live versions.

## GraphQL

With GraphQL enabled, each live version gets its own schema at
`/graphql/vN`, and `/graphql` serves the working schema. A field a version
still exposes but the working schema has renamed or removed is marked
`@deprecated` in that version's schema. For a rename the reason names the new
field name (`Renamed to 'heading' in v3.`); for a removal it says the field was
removed (`Removed in v3; column retained while this version is live.`).

A request for a retired or unknown version answers HTTP 200 with a GraphQL
error. Its `extensions.code` is `VERSION_RETIRED` or `VERSION_UNKNOWN`, and it
lists the live versions. GraphQL clients show errors in a 200 response
readably, but report a 4xx as an opaque network failure.

## Commands

| Command | What it does |
| --- | --- |
| `manguito version:list` | Lists live versions, oldest first, with how far each is behind the working schema. Writes nothing. |
| `manguito version:diff` | Shows what `version:create` would freeze, field by field. Writes nothing. |
| `manguito version:create` | Freezes the working schema as the next version. Refuses if no column changed since the last version. `--yes` skips the confirmation. |
| `manguito version:retire vN` | Deletes the `vN` snapshot after confirming, and lists any removed fields you must then delete. Refuses to retire the newest snapshot, because the working schema's number is derived from it. |

`manguito version:cut` is the old name of `version:create`. It still works,
prints a deprecation notice, and will be removed in a future release.

`manguito validate` checks every version along with your schema, so run it
before `build` or in CI.

> **Development applies changes directly.** `manguito dev` applies schema
> changes with `drizzle-kit push`, which asks whether a column was renamed,
> confirms before dropping a column that holds data, and leaves no migration
> file to review. Once a retired version's removed fields are deleted and you
> confirm, their columns, and that data, are gone. In production,
> `manguito migrate` generates a reviewable migration and asks before dropping
> anything.

## Validation errors

The CLI prints each error's message; the code names which check fired.

| Code | Meaning |
| --- | --- |
| `VERSION_COLUMN_MISSING` | A live version exposes a column the working schema no longer has. Keep it as a `removed` field, or retire that version. |
| `FIELD_TYPE_CHANGED_WHILE_LIVE` | A live version exposes this column with a different type. |
| `ORPHANED_TOMBSTONE` | A `removed` field's column is exposed by no live version. Delete the field. |
| `VERSION_SNAPSHOT_INVALID` | A snapshot under `schemas/versions/` does not parse. |
| `DUPLICATE_COLUMN` | Two fields resolve to the same column, often a half-finished rename. |
| `TOMBSTONE_REQUIRED` | A `removed` field is also `required`. |
| `FALLBACK_WITHOUT_TOMBSTONE` | A `fallback` on a field that is not `removed`. |
| `UNRENAMEABLE_FIELD_KIND` | `column` or `removed` on a field with no storage column. |

## Known limitations

- **Paragraph types are not versioned** (above). `version:diff` still lists
  paragraph field changes, but no version serves them differently.
- **The OpenAPI document is not versioned.** It describes only the working
  schema's unversioned paths, so a client generated from it cannot target a
  pinned version.
- **No support window.** Nothing limits how many versions are live or for how
  long. `version:list` shows the count; the policy is yours.

## See also

- [`schema-authoring.md`](./schema-authoring.md): field properties, including
  `column`, `removed` and `fallback`.
- [`graphql.md`](./graphql.md): the GraphQL API.
- [`programmatic-fields.md`](./programmatic-fields.md): resolvers and `ctx.get`.
- [`v2/schema-versioning.md`](./v2/schema-versioning.md): the design history and decision records.
