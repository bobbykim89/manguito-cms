# Dev Push Hardening — Design

**Status:** Written 2026-11-09. The maintainer chose hashed foreign-key names (§1) and grouped these items into one PR. Everything else is the author's call; see "Calls the author made".

One PR closes:

- **#88:** push re-plans foreign keys whose names are over 63 characters.
- **#89:** `ensureLinkConstraints` makes one catalog query, not several round trips per table.
- **Two CLI items of #72:**
  - overlapping `manguito dev` reloads;
  - each command parses schemas its own way.

All four sit on the path a schema save takes in `manguito dev`: parse, `ensureLinkConstraints`, push. Out of this PR:

- #90 (overlapping link saves) ships alone.
- #72's four tooling items (sandbox type-check, Dockerfile, the workspace cycle, admin type-checked twice) ship as a separate `chore/` PR. That PR and this one together close #72.

## 1. Foreign-key names past 63 characters (#88)

### Problem

drizzle names a foreign key `<table>_<column>_<target table>_<target column>_fk`. Postgres keeps the first 63 characters of an identifier. drizzle-kit 0.31.10 compares the stored, cut name against the full name in the schema, so it never sees them as equal.

This is common, not a corner case:

- A link table's foreign-key name repeats the owner table twice.
- `apps/sandbox/migrations/0000_eminent_zuras.sql` has two such foreign keys, from one ordinary many-to-many field:

  ```text
  72  junction_content_blog_post_blog_related_right_id_content_blog_post_id_fk
  71  junction_content_blog_post_blog_related_left_id_content_blog_post_id_fk
  ```

- Reference and media columns on type tables can pass 63 characters too.

### Observed

Both observations were made with drizzle-kit 0.31.10, the version in packages/db, on 2026-11-09, using throwaway tables.

- **Push, default names.** On an unchanged schema, every push plans `DROP CONSTRAINT "<cut name>"` and then `ADD CONSTRAINT "<full name>" FOREIGN KEY …` for both foreign keys.
- **Push, explicit names.** The same tables declared with `foreignKey({ name: <full name>.slice(0, 63), … })` print `[i] No changes detected`.
- **Generate.** A project whose snapshot holds the full name, regenerated with the explicit cut name, gets:

  ```sql
  ALTER TABLE "…" DROP CONSTRAINT "junction_content_blog_post_blog_related_left_id_content_blog_post_id_fk";
  ALTER TABLE "…" ADD CONSTRAINT "junction_content_blog_post_blog_related_left_id_content_blog_po" FOREIGN KEY ("left_id") REFERENCES "public"."content_blog_post"("id") ON DELETE cascade ON UPDATE no action;
  ```

  The DROP's name is cut to the same identifier, so this drops and re-creates an identical constraint. Re-creating a foreign key re-checks every row while holding a lock.

These observations used the cut name. A hashed name of 63 characters behaves the same, since both are stored whole. The upgrade test in "Testing expectations" confirms it with the hashed name.

### Decision (maintainer)

Long foreign keys get a hashed name of exactly 63 characters, the same scheme `linkUniqueName` uses for link uniques.

The maintainer first chose cut names, which leave existing databases untouched. They then chose the hash: no production deployment exists yet, so a one-time rename costs little, and the hash is the better long-term design.

- **Collisions.** Two foreign keys can no longer collide in their first 63 characters. The foreign-key collision errors, and the field renames they asked users to make, go away.
- **Existing projects.** Each long foreign key is dropped and re-added once under its new name:
  - automatically on dev's next push;
  - in the next migration `manguito migrate` generates.

  Re-adding a foreign key re-checks every row while holding a lock, which is accepted.
- **Migration rewrite.** None. drizzle-kit's drop and add is exactly the rename wanted.

Rejected: cut names (`<default>.slice(0, 63)`). They need no database change, but keep the collision errors and need a snapshot-reading rewrite to keep migrations from re-adding identical constraints.

### Design

**The name** (`packages/db/src/constraint-names.ts`)

- When drizzle's default name (`foreignKeyName`) is 63 characters or fewer, it is used as it is.
- Otherwise the name is `<default>.slice(0, 51)` + `_` + the first 8 hex characters of the SHA-256 of the whole default name + `_fk`. That is 51 + 1 + 8 + 3 = 63 characters.
- The hash covers the whole default name (table, column, target table and target column), so two foreign keys that share their first 51 characters still get different names.
- One exported function gives this name. Codegen and `findConstraintNameCollisions` both use it, so the name checked is the name emitted.

**Codegen** (`packages/db/src/codegen/index.ts`)

- When the default name is over 63 characters, emit the foreign key as an explicit `foreignKey({ name, columns, foreignColumns }).onDelete(…)` in the table's constraint callback. This applies in both places that emit `.references(…)`:
  - `generateFieldColumn`: reference and media columns on type tables.
  - `generateJunctionTables`: both sides of a link table.

  The third `.references(…)`, `users.role_id` in `SYSTEM_TABLES_SECTION` (`users_role_id_roles_id_fk`, 25 characters), is short and stays as it is.
- A foreign key whose default name is 63 characters or fewer keeps its inline `.references(…)`. Tables without a long foreign key therefore generate the same code as today.
- A type table can need the constraint callback for an enum check, a long foreign key, or both. Its constraints go in one callback.

**Collision check** (`findConstraintNameCollisions`)

With hashed names, two foreign keys collide only through a hash coincidence. Remove the checks and messages written for foreign keys that agree in their first 63 characters, together with their tests and suppression tests in `constraint-names.test.ts`:

- the foreign-key pair branch of `typeTableMessage`;
- the left-and-right branch of `checkLinkTable`, which made link tables stay within 61 characters.

These stay:

- check-constraint collisions;
- the link unique's schema-wide check (`checkLinkUniques`);
- a generic guard that every name codegen emits for one table is distinct in its first 63 characters, so a hash coincidence is still reported, not left to fail in a migration.

A foreign-key-and-check collision stays only if a fixture can still produce one with hashed names; otherwise its branch and tests go too.

Update `packages/db/CONTEXT.md` and code comments that describe the removed errors or the 61-character limit.

**Push** needs nothing beyond codegen: with a name of 63 characters or fewer, dev's push sees equal names (Observed). The first push after the upgrade renames each long foreign key once, with no data-loss prompt.

**ADR:** amend `docs/adr/db/0006-link-table-constraints-and-migration-rewrite.md`. Long foreign keys now get the same hashed-name scheme as link uniques, and the foreign-key collision errors are gone. ADR 0002's amendment from #86 mentions the collision check, so check whether it needs a line too.

## 2. One catalog query (#89)

`ensureLinkConstraints` (`packages/db/src/link-tables.ts`) runs up to three lookups per link table today: `to_regclass`, a `pg_constraint` lookup and an `information_schema.columns` check. It stops after the first two once the constraint exists.

Replace these with one query for all of the registry's link tables. For each table that exists in the current schema, it returns whether its `linkUniqueName` constraint exists and whether it has an `order` column.

- The clean-up `DELETE … RETURNING` and the `ADD CONSTRAINT` then run as today, only for tables missing the constraint.
- A registry with no link tables sends no query.
- The return value, the dedupe rule and the skipped-table behaviour are unchanged; the existing tests in `ensure-link-constraints.integration.test.ts` pin them.
- Today's `to_regclass('"t"')` resolves through `search_path`, while the `order` check uses `current_schema()`. The new query uses `current_schema()` for both, which is the schema push and the migrator write to.

## 3. One reload at a time (#72)

`manguito dev` has two watchers, one on the schemas folder and one on the programmatic resolvers folder.

- Each watcher's `for await` loop awaits `reloadSafely`, so one watcher's events already run one after another.
- Both watchers together can still run two reloads at once. Each writes `.manguito/` and pushes, and the older one can hot-swap last.
- One save also fires several events, and each runs a full reload in turn.

Both watchers call one queue instead:

- at most one reload runs at a time;
- a trigger during a reload marks one more reload, and any further triggers during that reload collapse into it;
- the follow-up reads the files fresh, so it applies the newest state;
- a reload that throws still goes through `reloadSafely` and doesn't stop the queue.

This is a small pure helper in `packages/cli/src/utils/`, unit-tested with deferred promises, plus the wiring in `dev.ts`.

## 4. One schema loader (#72)

Six places parse schemas, `roles.json` and `routes.json` with their own copy of the same loop:

- `commands/build.ts`
- `commands/dev.ts` (`parseAllSchemas`)
- `commands/migrate.ts`
- `commands/start.ts`
- `commands/validate.ts`
- `utils/registry.ts` (`loadWorkingRegistry`, used by `commands/version.ts`)

Replace the six loops with one function in `utils/registry.ts`. It parses everything, collects every error and returns a `Result` holding the registry. It neither prints nor exits.

- **Each command keeps its own reaction to failure:**
  - build and version print and exit 1, with their own headings;
  - migrate and start print their guided "Schema errors prevented seeding" error;
  - dev's reload returns the errors;
  - validate keeps going to print everything.
- **Each command keeps its own extra checks:** `checkRegistry` where it runs today, and version-model loading.
- **`base_path`.** `loadWorkingRegistry` passes `resolveSchemaConfig(cwd, config)` to `walkSchemaDirectory`. The other five pass `config.schema`, whose relative `base_path` core resolves against the process cwd. All six already resolve `roles.json` and `routes.json` with `resolve(cwd, config.schema.base_path, …)`.
  - The shared function uses `resolveSchemaConfig`, so only the walk's root changes.
  - It matches today whenever the process cwd is the project root, which is how the CLI runs.
- **Success counts.** Both validate ("Schemas valid (…)") and build ("Schemas parsed (…)", which also counts enum types) count from their parsed list. Their output must stay the same.
  - The counts can come from the registry: `buildSchemaRegistry` keeps every parsed schema, duplicates included, in `registry.all_schemas`, and has `registry.enum_types`.
  - Pin each count line with a test.
- `loadWorkingRegistry`'s docstring says build, start and migrate use it; only `version.ts` does. Correct the docstring with the change.

## Goals

- An unchanged schema with long foreign keys: dev's push prints "No changes detected".
- An existing project that upgrades: its long foreign keys are renamed once, then never again.
- Users never see a constraint-name error about two foreign keys.
- `ensureLinkConstraints` makes one round trip when every constraint exists.
- Saves close together in dev never run two reloads at once.
- One function parses a project's schemas for every command.

## Non-goals

- Renaming foreign keys of 63 characters or fewer.
- Other identifiers past 63 characters (tables, columns, check constraints); #86 covered link uniques.
- A drizzle-kit upgrade.
- #90, and #72's tooling items.

## Anti-goals

- A foreign key renamed on every push or every migration, which is the churn #88 reports.
- A rename that changes what a foreign key enforces (its columns, target or `onDelete`).
- Any change to which tables, columns or constraints exist, or to what they enforce, beyond the one-time rename of long foreign keys.
- A command printing different errors, or exiting differently, for the same broken schema, except where §4 says so.

## Constraints

- **Layers.** db imports only from core; cli imports from all.
- **Errors.** Expected failures return a Result; nothing throws for them.
- **Dependencies.** No new dependencies.
- **Shared test DB.** Every drizzle-kit push in a test uses a positive `tablesFilter`.
- **Changesets.** db patch for §1 and §2, cli patch for §3 and §4. These are fixes, with no API, config or schema surface change.
  - The db changeset must say that an existing project's long foreign keys are renamed once, on its next dev push or in its next generated migration.
  - It must also say that schemas which failed with a foreign-key `CONSTRAINT_NAME_COLLISION` now pass.

## Testing expectations

Every test names the mutation it rejects and is run red under it (PLAN-QUALITY rule 1).

- **Push settles.**
  - `ensure-link-constraints.integration.test.ts` › "plans no unique-constraint change for the hashed-name link table" today allows foreign-key churn on the 60-character link table. Tighten it to expect "No changes detected".
  - Mutation: codegen keeps the inline `.references()` for long names.
- **Codegen.**
  - A long foreign key on a link table, and one on a type table that also has an enum check, each emit `foreignKey` with the hashed name and the right `onDelete`.
  - The name function:
    - returns the default for exactly 63 characters;
    - returns a 63-character hashed name for 64;
    - gives different names for two defaults that share their first 51 characters.
  - A table with only short foreign keys generates the same text as today.
- **Upgrade** (integration):
  - Push a project under the old codegen, then push it under the new one.
  - The first push renames each long foreign key, and `pg_constraint` shows the hashed names with the same columns, target and `onDelete`.
  - The second push prints "No changes detected".
- **Collision check.**
  - Fixtures that today fail with a foreign-key `CONSTRAINT_NAME_COLLISION` now pass: the 62-character link table, and two reference columns sharing 63 characters.
  - Check-constraint and link-unique tests, and their suppression tests, pass unchanged.
- **#89.**
  - Counting the statements `ensureLinkConstraints` sends (a wrapper on the db): one when every constraint exists, none with no link tables.
  - The existing integration tests still pass.
- **Reload queue.**
  - Two triggers in flight: at most one run at a time.
  - Three triggers during one run: exactly one follow-up.
  - A throwing run doesn't stop the next one.
  - A dev test shows both watchers go through the queue.
- **Loader.**
  - The existing command tests pass.
  - One test per failure reaction pins each command's output for a broken schema file.

## Calls the author made (for review)

1. Explicit names only for foreign keys over 63 characters, so the codegen diff is limited to tables that need it.
2. The hash covers drizzle's whole default name, with a 51-character readable prefix, matching `linkUniqueName`'s 8 hex characters.
3. Amend ADR db/0006 rather than write a new ADR.
4. The catalog query uses `current_schema()` for the table lookup.
5. The reload queue coalesces rather than queuing every event.
6. The shared loader resolves `base_path` with `resolveSchemaConfig` everywhere.

## Left to the builder

- **Query shape for #89**, for example `unnest` of two arrays joined to `pg_class`, `pg_constraint` and `pg_attribute`.
- **The wording of the generic collision guard's message.**
- **The shared loader's name and return shape.**
