# Command: test

Run this command before committing, opening a PR, or deploying.

---

## Pre-Test Checklist

- [ ] Dependencies are installed and up to date
- [ ] Environment variables for test mode are set (`.env.test`)
- [ ] Database / mocks are seeded if required

---

## Run Tests

### Unit Tests

```bash
# Replace with your test runner
npm test
# or
pytest
# or
go test ./...
# or
cargo test
```

### Integration Tests

```bash
npm run test:integration
# or
pytest tests/integration/
```

### End-to-End (E2E) Tests

```bash
# Playwright
npx playwright test

# Cypress
npx cypress run

# Selenium
python -m pytest tests/e2e/
```

### Coverage Report

```bash
npm run test:coverage
# or
pytest --cov=. --cov-report=html
```

---

## Interpreting Results

| Status | Action |
|--------|--------|
| All pass | Proceed to commit / PR / deploy |
| Failures in unit tests | Fix before committing |
| Failures in integration | Investigate — may be env issue |
| Coverage below threshold | Add missing tests before merging |

---

## Git Discipline (MANDATORY)

After tests pass, commit immediately:

```
git add .
git commit -m "test: <what was tested or fixed>

Why: <reason — new feature tests, regression fix, coverage improvement, etc.>"
```

If you fix a failing test:

```
git add .
git commit -m "fix: resolve failing test in <module>

Why: <what was broken and how it was fixed>"
```

---

## Notes

- Never skip tests to save time — fix or skip them explicitly with a documented reason.
- If a test is flaky, open a ticket immediately rather than ignoring it.
- Aim for >80% coverage on business-critical modules.
