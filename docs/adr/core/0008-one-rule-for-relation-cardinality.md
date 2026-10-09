---
status: accepted
---

# One rule decides whether a relation holds one item or a list

`relationCardinality(field)` in core (`packages/core/src/registry/cardinality.ts`) is the only place that maps a relation's `rel` to one item or a list. Every layer that shapes, validates or renders a relation value calls it: the API's REST and GraphQL reads, admin write validation, the write-schema codegen, and the admin's paragraph editor, reference picker and form defaults. The admin imports it from the browser-safe subpath `@bobbykim/manguito-cms-core/cardinality`, because core's main entry also carries Node-only code.

| `field_type` | `rel` | Holds |
|---|---|---|
| `paragraph` | `one-to-one` | one: an object, or `null` |
| `paragraph` | `one-to-many` | a list |
| `reference` | `one-to-one` | one: an id (or the resolved object), or `null` |
| `reference` | `one-to-many` | one, **deprecated** |
| `reference` | `many-to-many` | a list |

## Why

Before this rule, five layers each decided for themselves, and they disagreed:

- a `one-to-many` reference was one FK column in the database, a list to the admin, GraphQL and the codegen, and a single object to REST reads;
- a `one-to-one` paragraph was an object to the codegen and a list everywhere else.

The results: a two-item reference save returned a 500 with SQL in the message, and a one-to-one paragraph sent as an object was silently dropped, which on an update erased the stored value. See [the design](../../superpowers/specs/2026-10-09-relation-cardinality-design.md).

## Considered Options

- **`one-to-many` reference as a real list** (a junction table): rejected. It duplicates `many-to-many`, needs a data migration, and moving a field from a column to a junction table is a change schema versioning restricts on live versions.
- **Removing `one-to-many` from references outright:** deferred. It is the same end state as the deprecation, but breaks every project using it at once. The parser still accepts it; `manguito validate`, `build` and `dev` print a warning (`findSchemaDeprecations`).
- **Patching each layer in place:** rejected. It is a smaller change, but it keeps the duplication that caused the disagreement.

## Consequences

- A required single reference's foreign key is `ON DELETE RESTRICT`; an optional one keeps `SET NULL`. The admin delete routes check first and answer 409 `ITEM_IN_USE`, naming each type and field that still uses the item. The constraint is the backstop for a use added after that check.
- The delete routes remove the item's row before its paragraph rows and media references. With no transactions, cleaning up first would corrupt an item whose delete is then refused.
- Adding a relation kind means changing `relationCardinality` and its table above. No layer may compare `rel` itself.
- Admin writes validate relation shapes before touching the database (422 `VALIDATION_ERROR`). An update skips relation fields absent from its body.
