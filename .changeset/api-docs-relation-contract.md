---
"@bobbykim/manguito-cms-api": patch
---

The route schemas generated into `.manguito/routes.ts` agree with the API on two more points. A field the API stores and returns as null is typed `.nullable()` as well as `.optional()`: a "one" relation, and any field whose column is nullable. List relations (empty is `[]`) and optional booleans (NOT NULL with a default) stay non-null. The content and taxonomy DELETE routes document the 409 `ITEM_IN_USE` response.
