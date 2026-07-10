---
"@bobbykim/manguito-cms-core": patch
"@bobbykim/manguito-cms-db": patch
"@bobbykim/manguito-cms-api": patch
"@bobbykim/manguito-cms-admin": patch
"@bobbykim/manguito-cms-cli": patch
---

Fix `npx @bobbykim/manguito-cms-cli` failing with "Cannot find module 'typescript'". The CLI uses `tsup`/`vite` at runtime to build user projects, but `typescript` (required by `tsup`) was only a devDependency, so it was missing from installs. `typescript` is now a runtime dependency, and the duplicated `tsup` devDependency was removed.

Fix `manguito init` generating an invalid `manguito.config.ts`. The chosen storage adapter was interpolated as a bare word (`storage: local,` — an undefined identifier) instead of a factory call. The scaffolder now emits the correct `createLocalAdapter()` / `createS3Adapter()` / `createCloudinaryAdapter()` call, imports only the chosen adapter, and writes the matching storage variables into `.env.example`.

Also add `homepage` and `repository` metadata (pointing to the GitHub repo) to all packages.
