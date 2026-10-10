---
"@bobbykim/manguito-cms-api": patch
---

The generated OpenAPI docs now match what the API accepts and returns. A field that can be empty is typed `.nullable()` as well as `.optional()`, a "one" relation included; list relations stay non-null, since an empty list is `[]`. The content and taxonomy delete routes document the 409 `ITEM_IN_USE` response.
