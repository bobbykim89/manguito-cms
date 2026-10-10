---
"@bobbykim/manguito-cms-core": minor
---

Taxonomy types now list their many-to-many link tables in `db.junction_tables`, as content types do. `TaxonomyDbMeta` gains the required `junction_tables` field, so code that builds a parsed taxonomy type by hand must add it (an empty array when the type has no many-to-many fields).
