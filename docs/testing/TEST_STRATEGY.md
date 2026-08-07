# MCP Sentinel — Test Strategy

## 1. Overview

This document defines the comprehensive testing strategy for MCP Sentinel,
a privileged system-administration platform that manages Linux servers via
MCP (Model Context Protocol) tools.

## 2. Test Layers

### 2.1 Unit Tests (`tests/*.test.js`)
- Test individual functions and modules in isolation
- Mock external dependencies (child_process, fs, network)
- Cover all exported functions and meaningful internal branches
- Framework: Node.js built-in test runner (`node:test`)

### 2.2 Integration Tests
- Test module interactions (e.g., security → keystore → sqlite-state)
- Use real SQLite databases (temporary)
- Test broker client-server communication

### 2.3 API/Route Tests
- Test HTTP endpoints with real Express handlers
- Verify authentication, authorization, validation
- Test error responses and edge cases

### 2.4 MCP Protocol Tests
- Test all 45 registered MCP tools
- Verify tool schemas match runtime validation
- Test authorization before side effects
- Test error handling and cleanup

### 2.5 Browser E2E Tests (`tests/ui-e2e.test.js`)
- Real Playwright browser testing
- Cover all UI pages and interactions
- Test responsive design and accessibility

### 2.6 Privileged E2E Tests (`tests/live-mcp-e2e.test.js`)
- Test actual system operations in disposable environments
- Require root privileges
- Run only in isolated CI containers

## 3. Coverage Requirements

| Metric | Threshold | Enforcement |
| ------ | --------- | ----------- |
| Statements | 100% | c8 `--check-coverage` |
| Branches | 100% | c8 `--check-coverage` |
| Functions | 100% | c8 `--check-coverage` |
| Lines | 100% | c8 `--check-coverage` |

### Coverage Rules
1. No `c8 ignore` comments in production code
2. No skipped tests without explicit justification
3. Every test must verify observable behavior
4. Coverage measured by c8 with `all: true`

## 4. Test Organization

```
tests/
├── *.test.js          # Unit and integration tests
├── live-mcp-e2e.test.js  # Privileged E2E (requires root)
├── ui-e2e.test.js     # Browser E2E (requires Playwright)
```

## 5. CI Integration

### Jobs
1. **Code Quality** — ESLint, Prettier, secret scanning
2. **Unit Tests & Coverage** — All unit tests with 100% coverage gate
3. **End-to-End Tests** — Playwright UI tests + privileged tests
4. **Security Audit** — npm audit, Gitleaks, TruffleHog

### Quality Gates
- All tests must pass
- Coverage must meet 100% thresholds
- No hardcoded secrets
- No lint violations

## 6. Test Data Management

- Use temporary directories (`os.tmpdir()`)
- Use temporary SQLite databases
- Use fake API keys and JWT secrets
- Clean up all resources in `after()` hooks
- Never modify real system state in non-privileged tests

## 7. Mocking Strategy

- Mock `child_process.exec/execFile` for system commands
- Mock `fs` operations for system file access
- Mock network calls for external services
- Use `node:test` mock utilities (`mock.fn()`, `mock.method()`)
- Never mock the code under test

## 8. Security Testing

- Test all authentication paths (JWT, API keys, WebAuthn, OAuth)
- Test authorization for every endpoint and MCP tool
- Test input validation and injection prevention
- Test secret redaction in logs and errors
- Test CORS, CSP, and security headers

## 9. Privileged Test Safety

Tests that modify system state (users, services, firewall, etc.) must:
1. Run only in disposable environments
2. Check for root privileges before executing
3. Use unique resource prefixes
4. Clean up in guaranteed `after()` hooks
5. Never run against production systems
