---
"@bobbykim/manguito-cms-cli": minor
---

Ships ordered `many-to-many` lists (core and api). **Run `manguito migrate` before deploying this version**: it adds an `order` column to each link table, which every read and write of those types now uses.
