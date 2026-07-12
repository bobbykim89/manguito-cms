---
"@bobbykim/manguito-cms-admin": minor
"@bobbykim/manguito-cms-cli": patch
---

Fix the admin panel failing (404 in `manguito dev`, unbuildable in `manguito build`) in installed projects. `dev`/`build` build the admin by running Vite against the admin package, but it previously shipped only `dist/`. The admin package now publishes its Vite source (`index.html`, `src/`, `public/`, `vite.config.ts`) and promotes its build toolchain (`vite`, `@vitejs/plugin-vue`, `@tailwindcss/vite`, `tailwindcss`) to dependencies, and the CLI is aligned to Vite 8 to match the admin. `dev`/`build`/`start` behavior is unchanged.
