---
'@bobbykim/manguito-cms-api': patch
---

Generated route descriptions quote the type's label safely (#68). A label with an apostrophe, such as `Author's Note`, used to end its single-quoted string and make the generated routes file invalid, which broke `manguito build` and `manguito dev`.
