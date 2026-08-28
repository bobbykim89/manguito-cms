---
status: accepted
---

# A field's label and its storage key are separate; the storage key is immutable

`ParsedField.name` is a **label** — the public name consumers and the admin panel see. `db_column.column_name` is the **storage key** — the Postgres column, fixed for the life of the data. The two fields already existed as distinct concepts before this stage, and `fieldTypeRegistry` sets `column_name` to `raw.name` for every field type today, so label and storage key are equal for every field a schema author has never renamed — divergence does not exist yet. What this stage changed is that no code in the api package may still *assume* equality: every consumer that read or wrote a field by name was audited to use the correct one. Divergence itself arrives with schema versioning, which folds a rename chain into `column_name` while leaving the label free to change.

The api package converts at exactly two boundaries, both closed by a `FieldKeyMap`. One is built per content/taxonomy type, once, at startup in `app.ts`, keyed by the full machine name (`content--x` / `taxonomy--x`) — and it throws on construction if a field's label collides with another field's column, matching how the app already refuses to boot on a broken roles registry rather than silently producing an ambiguous mapping. Inbound: each admin write handler computes `storageBody = fieldKeys.toStorage(body)` once. Outbound: every read response — public and admin alike — maps through `fieldKeys.toLabels(row)`. There is no unprojected path between them.

Only column-backed fields participate. Paragraph fields have no column (their association lives on the paragraph table via `parent_field`) and many-to-many references have none either (the junction table, whose name embeds the field name, owns the association). Both keep the label as their identity, so **renaming a paragraph or many-to-many field is not supported** — schema versioning rejects such a rename and directs the author to retire the older version first.

## Considered Options

- **Keep label and column identical; rename the column on a schema rename** — rejected: `drizzle-kit generate` cannot infer a rename from a schema diff and prompts interactively to distinguish rename from drop-plus-add. That is unusable in a non-interactive `manguito build`, and the drop-plus-add branch destroys exactly the data an older API version still serves.
- **A general `storage_key` on every field kind**, including paragraph and many-to-many — rejected for now: it requires changing `parent_field` semantics and junction table naming, both of which are persisted in existing databases. The narrower rule buys renameability for the fields authors actually rename.

## Consequences

- Relation resolution deletes the raw FK key from a row when it resolves into a different label; when they match it overwrites in place, as before. Applied identically to the `reference` and `media` branches in `relations.ts`.
- Filters are validated against labels and emitted as storage keys: both `parseFilters` (REST, `routes/query-params.ts`) and `translateFilters` (GraphQL, `graphql/filters.ts`) gained an optional `columnFor` mapper, so existing two-argument callers are unchanged and a client naming a raw column still gets the existing 400.
- GraphQL field *names* still come from labels (`naming.ts` is untouched); only value lookup and filter emission changed. `fieldKeyMaps` is threaded `app.ts` → `createGraphQLHandler` → `buildGraphQLSchema` → resolvers, and the module stays behind its dynamic import ([ADR api/0006](./0006-subpath-exports.md)).
- Public route paths are now built in one module, `paths.ts`, which also makes the previously non-functional `api.prefix` option actually route. Both prefix-default sites — `app.ts` and `createAPIAdapter` in `index.ts` — normalize through the same `normalizePrefix`.
- Because Hono infers path-param types from *literal* path strings, computing paths through `paths.ts` erases that inference: three handlers (`routes/media.ts`'s media-item route, `routes/content.ts`'s item and taxonomy-item routes) carry a documented non-null assertion on `c.req.param(...)`, each guaranteed safe by the route pattern that registered it — the builder unconditionally appends the `:slug`/`:id` segment. A coming runtime version segment makes literal paths impossible anyway, so this is a permanent shape rather than a temporary wart.
- One existing test was changed rather than only added to: `packages/api/src/__tests__/relations.read.integration.test.ts`'s bare-reference-id assertion now expects the label instead of the raw column, because its fixture hand-writes a reference field whose label diverges from its column — a divergence no parser-produced schema can reach today — and the old assertion characterized exactly the column-name leak this stage exists to close.
