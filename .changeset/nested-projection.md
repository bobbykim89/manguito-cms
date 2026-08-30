---
'@bobbykim/manguito-cms-api': patch
---

Read responses now project nested rows — paragraph children, resolved reference and junction targets — to field labels rather than storage column names, and `?sort_by=` validates a label then orders by its column. GraphQL's `sortBy` gets the same treatment: its sort enum's `title` value is a field label, not a column, so it is now mapped to the storage column before the query builds its `ORDER BY`. No behavior changes for any schema the parser currently produces, since labels and columns are identical there.

One new startup check: paragraph types now get field key maps too, so a paragraph type whose field label collides with another of its own columns refuses to boot. Unreachable today, since that requires two same-named fields on one type, which the parser already rejects.
