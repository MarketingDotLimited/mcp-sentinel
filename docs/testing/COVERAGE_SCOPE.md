# MCP Sentinel — Coverage Scope Policy

**Date**: 2026-08-07
**Enforcement**: Per-File 100%
**Status**: Enforced in CI

## Authority & Configuration

Coverage scope is authoritatively configured in [.c8rc](file:///root/mcp-server/.c8rc).

```json
{
  "all": true,
  "check-coverage": true,
  "per-file": true,
  "statements": 100,
  "branches": 100,
  "functions": 100,
  "lines": 100
}
```

## Scope Inclusion Categories

Every first-party executable production JavaScript module is included in coverage measurement:

1. **Root Entry Points**: `server.js`, `broker.js`, `node-gateway.js`, `audit.js`, `keystore.js`, `security.js`
2. **Library Modules**: `lib/**/*.js` (27 files)
3. **Route Modules**: `routes/**/*.js` (2 files)
4. **MCP Tool Modules**: `tools/**/*.js` (8 files)
5. **Scripts**: `scripts/**/*.js` (11 files)
6. **Browser Client SPA**: `public/js/**/*.js` (21 files)

## Verification Script

The scope inclusion policy is validated in CI via [`scripts/verify-coverage-scope.mjs`](file:///root/mcp-server/scripts/verify-coverage-scope.mjs) which verifies that no production JS directory is omitted from c8 coverage.
