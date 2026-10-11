---
"@bobbykim/manguito-cms-core": minor
---

Every `many-to-many` reference's link table now has an `order` column (`junction.order_column` is `true`), so a list can keep the order it was saved in. Run `manguito migrate` after upgrading: it adds the column to each existing link table, a non-destructive change.
