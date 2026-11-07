---
"@bobbykim/manguito-cms-core": minor
---

`validateCrossReferences` refuses two schema types or many-to-many fields that would get the same database table, with the new `TABLE_NAME_COLLISION` error code. A link table is `junction_<type's table>_<field>`, so field `x_y` on `taxonomy--tag` and field `y` on `taxonomy--tag_x` got the same one. Postgres also keeps only the first 63 characters of a name, so two long names that differ only after that became one table. Such a schema used to fail later and obscurely: generated code declared the table twice, or the migration was refused with "relation already exists". The message now names both, and says which name to shorten and to what length.

`DUPLICATE_COLUMN` also covers two field names in one type that differ only after their first 63 characters, which Postgres would make one column.
