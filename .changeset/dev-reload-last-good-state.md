---
"@bobbykim/manguito-cms-cli": patch
---

`manguito dev` keeps running when a schema edit has an error. A parse error (a typo in a schema file, roles.json or routes.json) used to exit the dev server; now it prints the error, says the changes were not applied, and keeps serving the last good schema. An edit that breaks the version model no longer rewrites the `.manguito` files before being refused, so they stay in step with what dev serves.
