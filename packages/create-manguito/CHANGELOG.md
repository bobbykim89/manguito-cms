# @bobbykim/create-manguito

## 0.1.1

### Patch Changes

- e0ff9a8: Fix a freshly scaffolded project failing to run under pnpm. Four scaffold issues are corrected so `manguito validate` / `manguito dev` work out of the box:

  - Package scripts now pass `--env .env` (`manguito dev --env .env`, etc.), so `pnpm dev`/`migrate`/… actually load the `.env` file instead of erroring with `DB_URL_MISSING`.
  - The example schema files are renamed to carry their required machine-name prefix (`content--blog_post.json`, `taxonomy--tag.json`); the parser rejects filenames without it.
  - An empty `schemas/enum-types/` folder is scaffolded (with a `.gitkeep`); the parser errors on a missing schema folder.
  - `drizzle-kit` is added as a direct devDependency, so its bin resolves on PATH under pnpm (which does not link transitive-dependency bins) when `manguito dev`/`build` run migrations.
