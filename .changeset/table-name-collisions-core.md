---
"@bobbykim/manguito-cms-core": minor
---

`validateCrossReferences` refuses two schema types or many-to-many fields that would get the same database table, with the new `TABLE_NAME_COLLISION` error code. A link table is `junction_<type's table>_<field>`, so field `x_y` on `taxonomy--tag` and field `y` on `taxonomy--tag_x` shared one and mixed their links; and Postgres keeps only the first 63 characters of a name, so two long names that differ only after that became one table. Rename or shorten one of the names.
