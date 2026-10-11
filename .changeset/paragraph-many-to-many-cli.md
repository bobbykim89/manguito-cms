---
"@bobbykim/manguito-cms-cli": minor
---

Ships core's new `UNSUPPORTED_RELATION` check: `manguito validate`, `dev` and `build` now refuse a paragraph type with a `many-to-many` reference, whose links were never stored. The CLI pins core at an exact version, so this is a minor.
