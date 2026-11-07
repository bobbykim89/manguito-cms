---
"@bobbykim/manguito-cms-cli": minor
---

Ships core's `TABLE_NAME_COLLISION` check: `manguito validate`, `dev`, `build` and the `version:*` commands refuse two schema types or many-to-many fields that would share a database table. A project with such a collision now fails these commands until one of the names changes. Its data was already being mixed in the shared table.
