---
"@bobbykim/manguito-cms-api": patch
---

Deleting an item no longer fails when only its own paragraph refers back to it. A field named `constructor` (or any prototype key) is no longer mistaken for present in a request body. Paragraph rows that share a position now read in id order, a link stored twice reads once at its first position, and the admin edit read loads its relation fields in parallel.
