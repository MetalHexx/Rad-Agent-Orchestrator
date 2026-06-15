---
name: rad-run-tests
description: 'Run the project test suite and report results. Use when executing tests, running unit tests, integration tests, validating code changes, checking test coverage, or verifying acceptance criteria. Provides structured test execution with pass/fail reporting and error details.'
user-invocable: false
---

# Run Tests

Execute the project's test suite and report structured results. This is an instructions-only skill with no template — it guides the agent through discovering and running tests, then reporting results.

## When to Use This Skill

- After implementing code changes that need validation
- When a task's acceptance criteria include "all tests pass"
- When the Coder Agent needs to verify test results before completing a task
- When checking if prior test failures have been resolved after a corrective task

## Workflow

### Step 1: Discover the Test Runner

Find the project's test configuration:

1. Check `package.json` for `scripts.test` (Node.js projects)
2. Check for `jest.config.*`, `vitest.config.*`, `playwright.config.*`
3. Check for `pytest.ini`, `setup.cfg`, `pyproject.toml` (Python projects)
4. Check for `Cargo.toml` (Rust projects)
5. Check for `go.mod` (Go projects)
6. Read `orchestration.yml` for any custom test commands

### Step 2: Run All Tests

Execute the discovered test command. Common patterns:

- **Node.js**: `npm test` or `npx jest` or `npx vitest run`
- **Python**: `pytest` or `python -m pytest`
- **Rust**: `cargo test`
- **Go**: `go test ./...`

### Step 3: Parse Results

Capture and structure the output:

- Total tests run
- Tests passing
- Tests failing (with failure details)
- Tests skipped
- Coverage percentage (if available)

### Step 4: Run Targeted Tests (if applicable)

If the task handoff specifies particular test files:

1. Run only those specific test files first
2. Then run the full suite to check for regressions

### Step 5: Report Structured Results

Format results for inclusion in task output:

```
Tests: {passing}/{total} passing
Failures:
- {test name}: {error message}
Coverage: {X}% (if available)
Build: {pass/fail}
```

## Key Rules

- **Actually run the tests**: Never assume results — execute the command and parse real output
- **Report failures with details**: Include the test name, file, and error message for every failure
- **Run the full suite**: Even if only specific files were changed — check for regressions
- **Note flaky tests**: If a test passes on retry, note it as potentially flaky
- **Build must also pass**: Run the build command alongside tests — both must succeed

## Troubleshooting

| Issue | Resolution |
|-------|------------|
| No test runner found | Check project root for config files; ask human if unclear |
| Tests timeout | Increase timeout or note as an issue |
| Missing dependencies | Run install command (`npm install`, `pip install`, etc.) first |
| Environment issues | Check for required env vars, database connections, or services |
