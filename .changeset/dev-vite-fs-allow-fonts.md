---
"@bobbykim/manguito-cms-cli": patch
---

Fix `manguito dev` returning 403 for the admin panel's `@fontsource` font files ("outside of Vite serving allow list") in installed projects. The admin (Vite root) resolves deep inside `node_modules/.pnpm`, so Vite's default file-serving allow list didn't cover sibling dependencies like the fonts. `dev` now sets `server.fs.allow` to the project root and the detected workspace root, so the fonts (and other project deps) are served. Serving behavior is otherwise unchanged.
