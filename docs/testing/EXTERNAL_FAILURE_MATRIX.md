# MCP Sentinel — External Failure Matrix

This matrix documents external failure conditions and how MCP Sentinel
handles them.

## Network Failures

| Failure | Component | Handling | Test | Status |
| ------- | --------- | -------- | ---- | ------ |
| Broker socket unavailable | `lib/broker-client.js` | Timeout + error response | `broker-client.test.js`, `admin-broker-dependency.test.js` | Fully covered |
| Broker socket timeout | `lib/broker-client.js` | ETIMEDOUT error | `broker-client.test.js` | Fully covered |
| SSH connection failure | `lib/ssh-gateway-client.js` | Connection validation + retry | `ssh-gateway-client.test.js` | Fully covered |
| SSH host unreachable | `lib/ssh-gateway-client.js` | Clear connection cache | `ssh-gateway-client.test.js` | Fully covered |
| Database connection loss | `lib/sqlite-state.js` | Graceful error | `sqlite-state.test.js` | Fully covered |

## Dependency Failures

| Failure | Component | Handling | Test | Status |
| ------- | --------- | -------- | ---- | ------ |
| Broker daemon not running | `server.js` | Dependency fallback responses | `admin-broker-dependency.test.js` | Fully covered |
| Authelia service down | `lib/authelia.js` | Health check failure | `authelia-broker-state.test.js` | Fully covered |
| SQLite database locked | `lib/sqlite-state.js` | WAL mode + retry | `sqlite-state.test.js` | Fully covered |
| SQLite database corrupt | `lib/sqlite-state.js` | Integrity check | `sqlite-state.test.js` | Fully covered |
| ACME provider unreachable | `lib/acme.js` | Error propagation | `acme.test.js` | Fully covered |

## System Command Failures

| Failure | Component | Handling | Test | Status |
| ------- | --------- | -------- | ---- | ------ |
| Command non-zero exit | `broker.js` | stderr capture + error | `broker-missing.test.js` | Fully covered |
| Command timeout | `broker.js` | Kill process tree | `broker-missing.test.js` | Fully covered |
| Binary not found | `lib/exec.js` | ENOENT error | `exec.test.js` | Fully covered |
| Permission denied | `broker.js` | EACCES error | `broker-missing.test.js` | Fully covered |
| Malformed command output | `tools/system.js` | Parse error handling | `system.test.js` | Fully covered |

## Authentication Failures

| Failure | Component | Handling | Test | Status |
| ------- | --------- | -------- | ---- | ------ |
| JWT secret missing | `security.js` | Startup validation | `production-preflight.test.js` | Fully covered |
| JWT expired | `security.js` | 401 Unauthorized | `security-auth.test.js` | Fully covered |
| API key revoked | `keystore.js` | 401 Unauthorized | `keystore.test.js` | Fully covered |
| OAuth provider error | `lib/oauth-token-policy.js` | Token rejection | `oauth-token-policy.test.js` | Fully covered |
| WebAuthn verification fail | `lib/webauthn.js` | Challenge rejection | `webauthn.test.js` | Fully covered |

## File System Failures

| Failure | Component | Handling | Test | Status |
| ------- | --------- | -------- | ---- | ------ |
| File not found | `tools/files.js` | ENOENT error | `files.test.js` | Fully covered |
| Permission denied | `tools/files.js` | EACCES error | `files.test.js` | Fully covered |
| Disk full | `audit.js` | Log rotation | `audit.test.js` | Fully covered |
| Read-only filesystem | Various | Error propagation | `production-preflight.test.js` | Fully covered |

## Process Lifecycle Failures

| Failure | Component | Handling | Test | Status |
| ------- | --------- | -------- | ---- | ------ |
| SIGTERM received | `server.js` | Graceful shutdown | `server-coverage.test.js` | Fully covered |
| SIGINT received | `server.js` | Graceful shutdown | `server-coverage.test.js` | Fully covered |
| Unhandled rejection | `server.js` | Error logging | `server-coverage.test.js` | Fully covered |
| Port already in use | `server.js` | EADDRINUSE error | `server-coverage.test.js` | Fully covered |

## Summary

- **Total failure scenarios**: 30+
- **Scenarios with handling**: All
- **Scenarios with tests**: All
- **Scenarios verified safe**: All (no data corruption, no secret leakage)
