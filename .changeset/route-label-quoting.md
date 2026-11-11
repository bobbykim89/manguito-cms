---
'@bobbykim/manguito-cms-api': patch
---

Generated routes quote a type's label and a singleton's base path safely (#68). A label such as `Author's Note`, or a singleton `default_base_path` with an apostrophe, used to end its single-quoted string and make the generated routes file invalid, which broke `manguito build` and `manguito dev`.
