# Command: db-migrate

Run this command when applying database migrations to any environment.

---

## Pre-Migration Checklist

- [ ] Confirm target environment (local / staging / production)
- [ ] Back up the database before proceeding
- [ ] Review the migration files to be applied (`pending migrations`)
- [ ] Run a dry-run / preview if the tool supports it
- [ ] Ensure no active transactions or locks on affected tables

---

## Run Migration

```bash
# Replace with your actual migration tool (Prisma, Flyway, Knex, Alembic, Django, etc.)

# Prisma
npx prisma migrate deploy

# Alembic (Python)
alembic upgrade head

# Knex
npx knex migrate:latest

# Django
python manage.py migrate
```

---

## Post-Migration Validation

- [ ] Verify the migration ran without errors
- [ ] Spot-check affected tables / records
- [ ] Run a smoke test on the feature that depends on this migration
- [ ] Confirm row counts / schema changes are as expected

---

## Rollback Procedure

```bash
# Prisma
npx prisma migrate resolve --rolled-back <migration_name>

# Alembic
alembic downgrade -1

# Knex
npx knex migrate:rollback

# Django
python manage.py migrate <app_name> <previous_migration>
```

---

## Git Discipline (MANDATORY)

After a successful migration:

```
git add .
git commit -m "db: apply migration <migration_name>

Why: <describe what schema change this introduces and why>"
```

If the migration fails and you roll back, still commit:

```
git add .
git commit -m "db: rollback migration <migration_name>

Why: <describe the failure reason>"
```

---

## Notes

- Never skip the backup step in production.
- Always test migrations on staging first.
- Document any manual data fixes in the commit message.
