# MCP Sentinel — Security Control Matrix

This matrix maps security controls to their implementation and test coverage.

## Authentication Controls

| Control                   | Implementation                   | Test Files                                           | Status        |
| ------------------------- | -------------------------------- | ---------------------------------------------------- | ------------- |
| JWT token issuance        | `security.js:issueToken`         | `security-auth.test.js`                              | Fully covered |
| JWT token validation      | `security.js:authenticateJWT`    | `security-auth.test.js`, `security-coverage.test.js` | Fully covered |
| Step-up token             | `security.js:issueStepUpToken`   | `security-auth.test.js`                              | Fully covered |
| API key authentication    | `security.js:authenticate`       | `security-auth.test.js`, `keystore.test.js`          | Fully covered |
| API key hashing (SHA-256) | `keystore.js:hashKey`            | `keystore.test.js`                                   | Fully covered |
| Password authentication   | `routes/auth.js`                 | `routes-auth.test.js`                                | Fully covered |
| WebAuthn registration     | `lib/webauthn.js`                | `webauthn.test.js`                                   | Fully covered |
| WebAuthn authentication   | `lib/webauthn.js`                | `webauthn.test.js`                                   | Fully covered |
| OAuth/OIDC token policy   | `lib/oauth-token-policy.js`      | `oauth-token-policy.test.js`                         | Fully covered |
| Session revocation        | `security.js:revokeSessionToken` | `security-auth.test.js`                              | Fully covered |
| Rate limiting             | `routes/auth.js`                 | `routes-auth.test.js`                                | Fully covered |

## Authorization Controls

| Control                    | Implementation                   | Test Files                        | Status        |
| -------------------------- | -------------------------------- | --------------------------------- | ------------- |
| Scope-based access         | `security.js:requireScope`       | `security-coverage.test.js`       | Fully covered |
| Scope checking             | `security.js:scopeAllows`        | `security-coverage.test.js`       | Fully covered |
| Role templates             | `security.js:ROLE_TEMPLATES`     | `security-coverage.test.js`       | Fully covered |
| Policy evaluation          | `lib/policy.js:evaluatePolicy`   | `policy.test.js`                  | Fully covered |
| Policy simulation          | `lib/policy.js:simulatePolicy`   | `policy-simulator.test.js`        | Fully covered |
| SSH access policy          | `lib/ssh-policy.js`              | `ssh-policy.test.js`              | Fully covered |
| Remote operation whitelist | `lib/remote-operation-policy.js` | `remote-operation-policy.test.js` | Fully covered |
| Capability packs           | `lib/capabilities.js`            | `capabilities.test.js`            | Fully covered |

## Cryptographic Controls

| Control                      | Implementation        | Test Files             | Status        |
| ---------------------------- | --------------------- | ---------------------- | ------------- |
| AES-256-GCM state encryption | `lib/state-crypto.js` | `state-crypto.test.js` | Fully covered |
| HMAC audit chain             | `audit.js`            | `audit.test.js`        | Fully covered |
| Key provider abstraction     | `lib/key-provider.js` | `key-provider.test.js` | Fully covered |
| Credential loading           | `lib/credentials.js`  | `credentials.test.js`  | Fully covered |

## Input Validation Controls

| Control                       | Implementation                       | Test Files                    | Status        |
| ----------------------------- | ------------------------------------ | ----------------------------- | ------------- |
| Command execution restriction | `lib/exec.js:secureExec`             | `exec.test.js`                | Fully covered |
| Privileged binary whitelist   | `lib/exec.js:PRIVILEGED_EXECUTABLES` | `exec.test.js`                | Fully covered |
| Database query classification | `tools/db.js:classifyQuery`          | `database-execution.test.js`  | Fully covered |
| Tool result schema validation | `lib/tool-result-schemas.js`         | `tool-result-schemas.test.js` | Fully covered |
| Deployment validation         | `lib/deployment.js`                  | `deployment.test.js`          | Fully covered |
| Deployment profile validation | `lib/deployment-profile.js`          | `deployment-profile.test.js`  | Fully covered |

## Audit Controls

| Control                  | Implementation              | Test Files          | Status        |
| ------------------------ | --------------------------- | ------------------- | ------------- |
| Access logging           | `audit.js:logAccess`        | `audit.test.js`     | Fully covered |
| Auth event logging       | `audit.js:logAuth`          | `audit.test.js`     | Fully covered |
| Security event logging   | `audit.js:logSecurityEvent` | `audit.test.js`     | Fully covered |
| Error logging            | `audit.js:logError`         | `audit.test.js`     | Fully covered |
| Argument sanitization    | `audit.js:sanitizeArgs`     | `audit.test.js`     | Fully covered |
| Audit chain verification | `scripts/verify-audit.js`   | `audit.test.js`     | Fully covered |
| Telemetry metrics        | `lib/telemetry.js`          | `telemetry.test.js` | Fully covered |

## Network Security Controls

| Control            | Implementation            | Test Files                     | Status        |
| ------------------ | ------------------------- | ------------------------------ | ------------- |
| IP whitelisting    | `security.js:ipWhitelist` | `security-coverage.test.js`    | Fully covered |
| CORS configuration | `server.js`               | `server-coverage.test.js`      | Fully covered |
| CSP headers        | `server.js`               | `server-coverage.test.js`      | Fully covered |
| Security headers   | `server.js`               | `smoke.test.js`                | Fully covered |
| HTTPS/TLS          | `server.js`               | `production-preflight.test.js` | Fully covered |

## Summary

- **Total security controls**: 35+
- **Controls with tests**: All
- **Controls with positive tests**: All
- **Controls with negative/bypass tests**: All authentication and authorization controls
