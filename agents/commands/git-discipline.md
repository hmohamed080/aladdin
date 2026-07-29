# Command: git-discipline

This is the MANDATORY Git workflow rule for every project. Copy this file into `.claude/agents/commands/` of any project you work on.

---

## The Rule

After **ANY** meaningful change, you must:

1. **Stage** the relevant files
2. **Commit immediately** — do not batch unrelated changes into one commit
3. Every commit message **must** answer two questions:
   - **WHAT** changed?
   - **WHY** did it change?

---

## Commit Message Format

```
<type>: <what changed — short, specific, imperative>

Why: <the reason or intent behind this change>
```

### Types

| Type | Use when |
|------|----------|
| `feat` | Adding a new feature |
| `fix` | Fixing a bug |
| `db` | Database migration or schema change |
| `deploy` | Deployment or release |
| `test` | Adding or fixing tests |
| `refactor` | Restructuring code without changing behavior |
| `style` | Formatting, naming, visual changes |
| `docs` | Documentation only |
| `chore` | Maintenance tasks (deps, config, CI) |

---

## Examples

```
feat: add user authentication with JWT

Why: users need secure login to access dashboard features
```

```
fix: prevent duplicate records on form resubmit

Why: pressing submit twice was creating duplicate entries in the database
```

```
db: add index on orders.user_id

Why: query performance was degrading with large datasets — this reduces lookup time by ~80%
```

---

## Quick Reference

```bash
# Stage all changes
git add .

# Stage specific files
git add src/feature.js tests/feature.test.js

# Commit with message
git commit -m "feat: <what>

Why: <why>"

# Push
git push origin <branch>
```

---

## Rules

- No commit should ever have just `"fix"`, `"update"`, or `"changes"` as a message.
- Never commit broken code — if the work is incomplete, use a `wip:` prefix and note what's missing.
- No meaningful change should remain uncommitted at the end of a session.
