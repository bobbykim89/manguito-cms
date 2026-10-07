# Schema Versioning — Design Index

**Status:** Delivered. Released in `@bobbykim/manguito-cms-core` 0.4–0.6,
`-db` 0.1.4–0.1.6, `-api` 0.4.1–0.7, `-admin` 0.4.1 and `-cli` 0.5–0.6; this closeout's own
release is `-cli` 0.7. User guide: [`../schema-versioning.md`](../schema-versioning.md).

Versioning lets a schema change without breaking the consumers already reading
the API. Each live version serves its own field names over the same rows; the
working schema is always the newest version.

## Design history

Read in order. Each spec records what it decided, what it deferred, and what it
found wrong in its predecessors.

| Sub-project | Spec | Decided |
|---|---|---|
| Umbrella | [schema-versioning-design](../superpowers/specs/2026-08-27-schema-versioning-design.md) | Version the contract, not the data. A snapshot directory's presence is the truth. The unversioned path resolves to latest, with deprecation headers. **Its rename log (`pending.json` / `history.json`) is superseded by the declarative model.** |
| Stage 1.5 | [nested-projection-and-sort-mapping-design](../superpowers/specs/2026-08-29-nested-projection-and-sort-mapping-design.md) | Projection recurses into nested rows; `sort_by` maps labels to columns. |
| 2a | [version-model-core-design](../superpowers/specs/2026-08-30-version-model-core-design.md) | Core computes the version model: live set, union and per-version projections. |
| 2a′ | [declarative-version-model-design](../superpowers/specs/2026-09-02-declarative-version-model-design.md) | A field *declares* its `column`; a removed field stays as a tombstone (`removed`, `fallback`). This replaces the rename log, so the union registry is the current registry. |
| 2b/2c | [cli-version-lifecycle-design](../superpowers/specs/2026-09-02-cli-version-lifecycle-design.md) | `version:diff`, `version:cut` (now `version:create`) and `version:retire`. |
| 2d | [versioned-rest-routes-design](../superpowers/specs/2026-09-03-versioned-rest-routes-design.md) | `/api/vN/*` per live version, deprecation headers, 410/404 for versions not served. |
| 2e | [graphql-versioning-design](../superpowers/specs/2026-09-21-graphql-versioning-design.md) | One GraphQL schema per live version at `/graphql/vN`, with `@deprecated` for renamed or removed fields. |
| 2f | [column-as-identity-design](../superpowers/specs/2026-10-01-column-as-identity-design.md) | The storage column is a field's identity inside the api too: relations resolve under it, the drop-set splits by key space, and resolvers read current's names. |
| Closeout | [versioning-closeout-design](../superpowers/specs/2026-10-05-versioning-closeout-design.md) | `version:create` and `version:list`; `validate` checks the version model; this index and the ADRs. |

## Decisions

- [ADR core/0007 — A field's storage column is its identity across versions](../adr/core/0007-column-is-cross-version-identity.md)
- [ADR api/0012 — Multi-version public API](../adr/api/0012-multi-version-public-api.md)
- [ADR api/0011 — A field's label and its storage key are separate](../adr/api/0011-field-label-vs-storage-key.md)
- [ADR db/0002 — Two-mode migrations](../adr/db/0002-two-mode-migrations.md): how `dev` applies schema changes directly, with no migration file to review.

The umbrella design also promised an amendment to ADR core/0003 justifying a
"derived union registry". Under the declarative model there is none: the union
**is** the current registry, with tombstones kept in it. So there is nothing
to justify, and no amendment was written.

## Deferred

Each of these was deliberately left out. Each needs its own design if taken up.

- **Paragraph types are not versioned.** Their columns are not retained for older
  versions, projections do not cover them, and `version:diff` still lists
  paragraph field changes that no version serves differently.
- **Non-interactive migrations can do nothing silently.** When a rename does not
  declare `column`, `drizzle-kit generate` has to ask "rename or create?". With
  no TTY it errors, exits 0, and writes no migration. The user guide tells
  authors to always declare `column`; the tooling does not yet refuse.
- **The CLI does not normalize `api.prefix` the way the server does.** It reads
  `config.api.prefix ?? '/api'`, while api uses `normalizePrefix` in
  `packages/api/src/paths.ts`. A config built without `createAPIAdapter` (for
  example `prefix: ''`) makes `version:create` and `version:list` print paths
  the server does not serve.
- **Core's version-model messages still say "cut".** For example, "newest cut
  version" in `packages/core/src/versions/validate.ts`, which `validate` and
  `build` print.
- **The api's `Warning: 299` header text still says "cut"**
  (`packages/api/src/versions.ts`).
- **The OpenAPI document is not versioned.** It lists only the unversioned paths
  of the working schema, so it does not describe an older version's contract.
- **Public taxonomy collections** ignore filter, sort and include, on both APIs.
- **`createGraphQLHandler` called directly**, without `createCmsApp` and with a
  version projection but no `currentFieldKeyMaps`, hands resolvers that
  version's names.
- **A union `/graphql`** exposing every live version's fields, and a `Sunset`
  header with a support window, are both deferred until someone asks.
- **A smoke test** that creates a version in `apps/sandbox` and exercises both
  route sets.
