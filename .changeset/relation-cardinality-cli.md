---
"@bobbykim/manguito-cms-cli": minor
---

`manguito validate`, `build` and `dev` print a warning for each reference that uses the deprecated `one-to-many`. Warnings do not change the exit code.

**Breaking (through dependencies):** this release pins the new `@bobbykim/manguito-cms-core`, `-api` and `-admin` minors, which change relation shapes. `manguito migrate` now generates `ON DELETE RESTRICT` for required references. See those packages' changelogs before upgrading.
