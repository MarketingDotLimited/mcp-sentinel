# MCP Sentinel — Coverage Exclusions

This document records every file excluded from the c8 coverage report and
provides justification for each exclusion.

## Canonical Configuration

The authoritative coverage configuration is `.c8rc` in the repository root.
The previously conflicting `.c8rc.json` has been **removed**.

## Excluded Files

### Test Infrastructure

| File/Glob | Reason | Executes in Production | Risk |
| --------- | ------ | ---------------------- | ---- |
| `tests/**` | Test files, not production code | No | None |
| `scratch/**` | Temporary scratch files | No | None |
| `node_modules/**` | Third-party dependencies | Yes (indirectly) | Covered by upstream |
| `coverage/**` | Generated coverage output | No | None |

### Configuration

| File/Glob | Reason | Executes in Production | Risk |
| --------- | ------ | ---------------------- | ---- |
| `eslint.config.js` | Linting configuration, not runtime code | No | None |

## Files NOT Excluded (Previously Were)

The following files were previously excluded or ignored but are now
**included** in coverage measurement:

| File | Previous Status | Current Status | Reason for Change |
| ---- | --------------- | -------------- | ----------------- |
| `server.js` | Excluded in `.c8rc.json` | **Included** | Core production code |
| `broker.js` | Excluded in `.c8rc.json` | **Included** | Core production code |
| `node-gateway.js` | Excluded in `.c8rc.json` | **Included** | Core production code |
| `lib/acme.js` | Excluded in `.c8rc.json` | **Included** | Production code |
| `lib/monitor.js` | Excluded in `.c8rc.json` | **Included** | Production code |
| `tools/git.js` | Excluded in `.c8rc.json` | **Included** | Production code |
| `tools/rollback.js` | Excluded in `.c8rc.json` | **Included** | Production code |
| `tools/services.js` | Excluded in `.c8rc.json` | **Included** | Production code |

## Known Gaps Requiring Future Work

### Browser JavaScript (`public/js/`)

**Status**: Not currently included in c8 server-side coverage.

**Reason**: These files execute in the browser, not in Node.js. c8 only
instruments V8 (server-side) code. Browser-side coverage requires Playwright
coverage collection merged into the final report.

**Plan**: The UI E2E test suite (`tests/ui-e2e.test.js`) exercises this code
via Playwright. Browser-side JS coverage collection should be added to merge
into the final report.

**Risk**: Medium — UI code paths may have untested branches.

### Scripts (`scripts/`)

**Status**: Not currently included in the c8 `include` array.

**Reason**: These are CLI scripts that run as standalone processes, not as
imported modules. Testing them requires spawning child processes.

**Plan**: Add integration tests that spawn each script and verify behavior.

**Risk**: Low-Medium — scripts handle backups, migrations, and deployments.

## c8 Ignore Comments

**Target**: Zero `c8 ignore` comments in production code.

| File | Previous Count | Current Count | Status |
| ---- | -------------- | ------------- | ------ |
| `server.js` | 415 | 0 | ✅ Resolved |
| `broker.js` | 6 | 0 | ✅ Resolved |
| `security.js` | 8 | 0 | ✅ Resolved |
| `audit.js` | 2 | 0 | ✅ Resolved |
| `lib/*.js` | ~35 | 0 | ✅ Resolved |
