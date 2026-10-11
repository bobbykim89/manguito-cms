---
"@bobbykim/manguito-cms-cli": minor
---

`manguito dev` and `manguito build` now run the same cross-reference validation as `manguito validate`, and stop on its errors before writing anything (`dev` keeps serving the last good schema when an edit introduces one). Before, only `validate` caught unknown or wrong-type references, circular paragraphs, media size limits, and the new `UNSUPPORTED_RELATION` (a `many-to-many` reference on a paragraph type, whose links were never stored). A project with such an error now fails `dev` and `build` until it is fixed.
