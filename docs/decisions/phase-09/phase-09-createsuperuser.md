# Decision — `manguito createsuperuser`

> Defines the superuser creation command, its precondition checks, interactive flow, and relationship to migrations.

---

## Purpose

`manguito createsuperuser` creates an admin user in the `users` table. It is modeled after Django's `python manage.py createsuperuser` — an independent, explicit command that can be run at any point after the database is initialized.

---

## Command Usage

```
manguito createsuperuser
manguito createsuperuser --env <file>
```

No other flags. The command is always interactive.

---

## Precondition Check

Before prompting for any input, the command checks that the `users` table exists via `tableExists('users')` on the Postgres adapter. If it does not exist:

```
✖ Database tables do not exist yet.
  Run `manguito migrate` first to set up the database, then try again.
```

Execution stops immediately. No prompts are shown.

---

## Interactive Flow

```
Creating superuser. Press Ctrl+C to cancel.

Username: admin
Email: admin@example.com
Password: ········
Confirm password: ········

✔ Superuser created successfully.
  You can now log in at /admin with the credentials above.
```

- Username, email, and password are prompted in sequence.
- Password input is masked — no characters echoed to the terminal.
- Password confirmation is required — mismatch re-prompts the password field without restarting the whole flow.
- Empty input for any field re-prompts that field.

---

## Validation

| Field | Rules |
| ----- | ----- |
| Username | Required, non-empty, unique in `users` table |
| Email | Required, valid email format, unique in `users` table |
| Password | Required, minimum 8 characters |

If username or email already exists in the DB, a clear error is shown and the relevant field is re-prompted:

```
✖ A user with that email already exists. Please use a different email.
Email:
```

---

## Role Assignment

The created user is always assigned the highest-hierarchy system role (typically `admin`). The role is looked up from the `roles` table by `hierarchy_level` — it is not hardcoded to the string `"admin"`. If no roles exist in the DB (seeder hasn't run):

```
✖ No roles found in the database.
  Run `manguito migrate` to seed system roles, then try again.
```

---

## When to Run

`manguito createsuperuser` is independent of the migration flow. It can be run:

- After first-time `manguito migrate` to create the initial admin user
- At any point to add additional admin users
- In staging environments to set up test admin accounts

It is intentionally not part of `manguito migrate` or `manguito init`:

- Migrations can run in CI/CD without accidentally creating user accounts
- The command can be run multiple times — each run creates a new user, it does not replace existing ones
- Developers have an explicit, memorable command for this task — consistent with the Django mental model many developers already know

---

## First Deploy Flow

```
1. manguito migrate          # initialize DB, apply migrations, seed roles
2. manguito createsuperuser  # create initial admin account
3. manguito start            # start production server
```
