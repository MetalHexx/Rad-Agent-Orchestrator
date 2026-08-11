# harness-files/tests/

## Purpose

Tests in this folder check the canonical source as a whole — agent skill-reference integrity, canonical CLI call form in shipped skills, and forbidden corrective-cycle claims — rather than any single skill or agent. Per-skill or per-agent tests live alongside their subject under each skill's own folder or co-located with each agent. If a test is not asserting about a whole-corpus invariant, it does not belong here.

## Run

All tests in this folder use Node's built-in test runner. Run from the repo root:

```
node --test harness-files/tests/*.test.mjs
```
