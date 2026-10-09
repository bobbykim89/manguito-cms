---
"@bobbykim/manguito-cms-api": minor
---

**Breaking:**

- A `one-to-one` paragraph is now an object (or `null`) in REST responses, admin responses and GraphQL; it was a one-item array. Update any client that reads it as an array, e.g. `field[0]`.
- In GraphQL, a deprecated `one-to-many` reference is a single object, matching REST.
- Admin writes validate relation shapes and answer 422 `VALIDATION_ERROR` for a wrong one. A one-item array for a one-item field, previously accepted, is now rejected.
- Deleting an item that a required reference still uses answers 409 `ITEM_IN_USE` with where it is used, instead of a 500.
- Unexpected errors answer `"Internal server error"`; they no longer include the underlying message, which could contain SQL and values.

**Fixes:**

- A `one-to-one` paragraph sent as an object is stored; it was silently dropped.
- An update that leaves out a paragraph or many-to-many field no longer erases it.

Run `manguito migrate` after upgrading (see the core changeset).
