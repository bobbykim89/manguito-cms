# Decision — `manguito users:promote` and `manguito users:demote`

> Defines the user management CLI commands — flag behavior, interactive prompts, guard rails, and output.

---

## Overview

These two commands provide CLI-based admin user management. They are intended for use on servers where the admin panel may not be accessible (e.g. first deploy, locked-down environments). Both commands require DB access and a live users table.

---

## Command Surface

```bash
manguito users:promote --email=<email>               # promote user to admin
manguito users:promote                               # prompt for email interactively

manguito users:demote --email=<email> --role=<role>  # demote to specified role
manguito users:demote                                # prompt for email and role interactively

# --env flag accepted on both
manguito users:promote --email=user@example.com --env .env.production
manguito users:demote --email=user@example.com --role=editor --env .env.production
```

---

## Shared Preconditions (Both Commands)

Checked before any prompts or DB writes:

1. **DB reachable** — if not:
   ```
   ✖ Cannot connect to the database.
     Check your DB_URL and ensure the database is running.
   ```

2. **`users` table exists** — if not:
   ```
   ✖ Users table not found.
     Run `manguito migrate` to initialise the database, then try again.
   ```

3. **User found by email** — if not found after email is provided:
   ```
   ✖ No user found with email "user@example.com".
   ```

---

## `manguito users:promote`

Assigns the highest-hierarchy role to the target user.

### Flag vs. Interactive

- `--email` provided → use it directly, skip email prompt
- `--email` omitted → prompt interactively:
  ```
  ? User email:
  ```

### Guard Rails

**Already at highest role → warn and stop:**
```
⚠ user@example.com is already an admin. No changes made.
```

### Success Output

```
✔ user@example.com promoted to admin.
```

### Role Lookup

The highest-hierarchy role is determined by querying the `roles` table for the row with the lowest `hierarchy_level` value. The role name is never hardcoded — it is always read from the DB.

---

## `manguito users:demote`

Assigns a lower role to the target user.

### Flag vs. Interactive

- Both `--email` and `--role` provided → use both directly, skip prompts
- Either omitted → prompt for the missing value(s):
  ```
  ? User email:
  ? Demote to role: (Use arrow keys — shows all roles below admin)
    ❯ manager
      editor
      writer
      viewer
  ```

The role select shows all roles except the highest-hierarchy role (admin cannot be a demotion target).

### Guard Rails

**Target role is same as current role → warn and stop:**
```
⚠ user@example.com is already assigned the "editor" role. No changes made.
```

**User is the last admin → block with guided error:**
```
✖ Cannot demote user@example.com — they are the only admin in the system.
  Promote another user to admin first, then try again.
```

The last-admin check queries the DB for the count of users assigned the highest-hierarchy role. If the count is 1 and the target user holds that role, the operation is blocked.

### Success Output

```
✔ user@example.com demoted to editor.
```

---

## `--env` Flag

Both commands accept `--env <file>` to load environment variables before DB connection. See [phase-09-env-flag.md](./phase-09-env-flag.md).

---

## Implementation Notes

- Both commands live in `src/commands/users.ts` as a Commander subcommand group
- `PromptAdapter` is used for all interactive prompts — never import `@inquirer/prompts` directly
- Role names and hierarchy levels are always read from the DB — never hardcoded
- The last-admin guard must be a separate DB query before the update — not inferred from application state
