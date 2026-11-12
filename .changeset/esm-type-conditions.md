---
'@bobbykim/manguito-cms-core': patch
'@bobbykim/manguito-cms-db': patch
'@bobbykim/manguito-cms-api': patch
---

ES module projects get ES module type declarations. Each export pointed `import` and `require` at the same `.d.ts`, which TypeScript reads as CommonJS, so a `"type": "module"` project with `NodeNext` resolution (the `create-manguito` default) mixed drizzle-orm's CommonJS and ES module types. Passing drizzle's `sql` to the db then failed to type-check. Each export now has its own `import` and `require` types (#72).
