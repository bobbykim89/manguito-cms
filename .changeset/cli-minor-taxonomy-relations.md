---
"@bobbykim/manguito-cms-cli": minor
---

Ships core 0.8.0 and the taxonomy relation support. The CLI pins its dependencies at exact versions, so this release is a minor: `manguito migrate` now generates the link tables for many-to-many fields on taxonomy types, which projects with such fields need to apply after upgrading.
