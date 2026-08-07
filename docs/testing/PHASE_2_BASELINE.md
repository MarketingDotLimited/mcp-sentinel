# MCP Sentinel — Phase 2 Baseline Assessment

**Date**: 2026-08-07
**Starting Commit**: `6fbc27c81c3f0634af20f6a86377024e6d994633`
**Historical Baseline Commit**: `ff2e4140548eaab51b7fa5a5de395d61f0874afd`
**Branch**: `test/phase-2-test-integrity-and-ci-proof`
**Environment**: Node.js `v22.23.2`, npm `10.9.8`, Linux x86_64

## Revalidated Baseline Observations

| #   | Observation                              | Status         | Impact / Root Cause                                                                                             |
| --- | ---------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Main CI Workflow Failing                 | ✅ Revalidated | `code-quality` & `unit-tests` jobs fail exit code 1.                                                            |
| 2   | ESLint Unused Variable Error             | ✅ Revalidated | `tests/security-oidc-branches.test.js:87:9` assigned value unused.                                              |
| 3   | Unit Tests & Coverage Exit Code 1        | ✅ Revalidated | `c8 check-coverage` fails (Lines 90.92%, Branches 89.41% vs required 100%).                                     |
| 4   | c8 Config Uses `per-file: false`         | ✅ Revalidated | `.c8rc` has `"per-file": false`.                                                                                |
| 5   | `public/js/**` Excluded from c8          | ✅ Revalidated | Browser JS omitted from `.c8rc` include list.                                                                   |
| 6   | `scripts/**` Excluded from c8            | ✅ Revalidated | Production scripts omitted from `.c8rc` include list.                                                           |
| 7   | Direct `process.exit(0)` Calls in Tests  | ✅ Revalidated | Forced process exits conceal open handles & asynchronous teardown issues.                                       |
| 8   | Swallowed Error Failures in Tests        | ✅ Revalidated | `.catch(() => {})` suppresses contract failures and errors without exact assertions.                            |
| 9   | Real-browser Test Skipped by Default     | ✅ Revalidated | `tests/ui-e2e.test.js` has `{ skip: !enabled }` when `RUN_UI_E2E` is unset.                                     |
| 10  | CI Missing Mandatory Browser Job         | ✅ Revalidated | GitHub Actions does not run Playwright tests with mandatory browser coverage.                                   |
| 11  | User-Needs Report Discrepancy            | ✅ Revalidated | `USER_NEEDS_COVERAGE.md` (7 personas, 35 needs) vs `user-needs-coverage.json` (3 personas, 26 needs).           |
| 12  | Production Code Modified in Test Commits | ✅ Revalidated | `server.js`, `broker.js`, `lib/control-plane.js`, `lib/exec.js`, `lib/project-operation-dispatcher.js` altered. |

## Execution Baseline Metrics

- **Unit Tests Passing**: 603 / 603
- **Unit Test Exit Code**: 0 (passes locally)
- **Lint Exit Code**: 1 (fails on `tests/security-oidc-branches.test.js`)
- **Coverage Check Exit Code**: 1 (fails threshold)
- **Current Statements**: 90.92%
- **Current Branches**: 89.41%
- **Current Functions**: 97.07%
- **Current Lines**: 90.92%
