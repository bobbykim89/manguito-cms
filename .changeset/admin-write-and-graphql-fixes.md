---
"@bobbykim/manguito-cms-api": patch
---

Fix three write/read paths that failed after the GraphQL release.

**Singleton content types could not be saved.** The admin form saves an `only_one` type with `PUT /admin/api/content/{type}` — it has no id in its route, so the `/:id` PATCH cannot address it — but no `PUT` route was ever registered, so every save 404'd. The route now exists as an upsert: it creates the row on first save and updates it thereafter, gated on `content:edit` plus `content:create` when it actually creates. POST, PATCH and PUT now share the same create/update code paths so the three verbs cannot drift apart.

**Media fields errored in GraphQL.** GraphQL read through the public REST repositories, which resolve relations eagerly — and because a media field's foreign-key column has the same name as the field, that eager pass overwrote the media id with the resolved media object. The dataloader then handed that object to `WHERE id IN (...)`, producing a Postgres `invalid input syntax for type uuid` error and a `null` field. GraphQL now reads through repositories that do not resolve relations eagerly, leaving its own per-field dataloaders to resolve them — which also stops every query from paying to resolve relations the client never selected. Media now resolves at the top level and inside paragraphs.

**Nested paragraphs were silently dropped.** A paragraph field on a paragraph type ([ADR core/0005](https://github.com/bobbykim89/manguito-cms/blob/master/docs/adr/core/0005-paragraph-nesting-one-level.md) allows exactly one level) has no column on its parent's table, so writes skipped it entirely and the admin edit read never descended into it — items added in the admin vanished on save. Nested rows are now persisted against their parent paragraph row, returned by the admin edit read, replaced on update, and removed when their parent paragraph or content item is deleted, with their media counted in reference tracking.
