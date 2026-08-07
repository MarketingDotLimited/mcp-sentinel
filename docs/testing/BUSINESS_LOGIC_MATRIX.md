# MCP Sentinel — Business Logic Matrix

## Business Rule Categories

### 1. Authentication Rules

| Rule ID | Rule                                        | Implementation                   | Test                         | Status        |
| ------- | ------------------------------------------- | -------------------------------- | ---------------------------- | ------------- |
| AUTH-01 | JWT tokens must expire after configured TTL | `security.js:issueToken`         | `security-auth.test.js`      | Fully covered |
| AUTH-02 | API keys must be hashed before storage      | `keystore.js:hashKey`            | `keystore.test.js`           | Fully covered |
| AUTH-03 | Invalid tokens must return 401              | `security.js:authenticateJWT`    | `security-auth.test.js`      | Fully covered |
| AUTH-04 | Revoked tokens must be rejected             | `security.js:revokeSessionToken` | `security-auth.test.js`      | Fully covered |
| AUTH-05 | Rate limiting must apply to auth endpoints  | `routes/auth.js`                 | `routes-auth.test.js`        | Fully covered |
| AUTH-06 | WebAuthn challenges must expire             | `lib/webauthn.js`                | `webauthn.test.js`           | Fully covered |
| AUTH-07 | OAuth tokens must validate issuer/audience  | `lib/oauth-token-policy.js`      | `oauth-token-policy.test.js` | Fully covered |
| AUTH-08 | Step-up tokens require prior authentication | `security.js:issueStepUpToken`   | `security-auth.test.js`      | Fully covered |

### 2. Authorization Rules

| Rule ID  | Rule                                         | Implementation                   | Test                              | Status        |
| -------- | -------------------------------------------- | -------------------------------- | --------------------------------- | ------------- |
| AUTHZ-01 | Scopes restrict tool access                  | `security.js:requireScope`       | `security-coverage.test.js`       | Fully covered |
| AUTHZ-02 | Role templates define default scopes         | `security.js:ROLE_TEMPLATES`     | `security-coverage.test.js`       | Fully covered |
| AUTHZ-03 | Policy evaluation determines tool access     | `lib/policy.js:evaluatePolicy`   | `policy.test.js`                  | Fully covered |
| AUTHZ-04 | SSH access follows hierarchical policy       | `lib/ssh-policy.js`              | `ssh-policy.test.js`              | Fully covered |
| AUTHZ-05 | Remote operations restricted to whitelist    | `lib/remote-operation-policy.js` | `remote-operation-policy.test.js` | Fully covered |
| AUTHZ-06 | Capability packs control tool visibility     | `lib/capabilities.js`            | `capabilities.test.js`            | Fully covered |
| AUTHZ-07 | Approval required for destructive operations | `lib/control-plane.js`           | `control-plane.test.js`           | Fully covered |

### 3. Privileged Operations Rules

| Rule ID | Rule                                               | Implementation                       | Test                     | Status        |
| ------- | -------------------------------------------------- | ------------------------------------ | ------------------------ | ------------- |
| PRIV-01 | Privileged commands must route through broker      | `lib/exec.js:secureExec`             | `exec.test.js`           | Fully covered |
| PRIV-02 | Direct execution of privileged binaries is blocked | `lib/exec.js:PRIVILEGED_EXECUTABLES` | `exec.test.js`           | Fully covered |
| PRIV-03 | Broker runs as root, server does not               | `broker.js`                          | `broker-missing.test.js` | Fully covered |
| PRIV-04 | Firewall changes require approval flow             | `tools/services.js`                  | `tools-services.test.js` | Fully covered |

### 4. Data Integrity Rules

| Rule ID | Rule                                    | Implementation            | Test                   | Status        |
| ------- | --------------------------------------- | ------------------------- | ---------------------- | ------------- |
| DATA-01 | State encrypted with AES-256-GCM        | `lib/state-crypto.js`     | `state-crypto.test.js` | Fully covered |
| DATA-02 | Audit logs protected by HMAC chain      | `audit.js`                | `audit.test.js`        | Fully covered |
| DATA-03 | Encrypted backups for state persistence | `scripts/backup-state.js` | `state-backup.test.js` | Fully covered |
| DATA-04 | Database migrations are idempotent      | `lib/sqlite-state.js`     | `sqlite-state.test.js` | Fully covered |

### 5. Database Query Rules

| Rule ID | Rule                                     | Implementation              | Test                         | Status        |
| ------- | ---------------------------------------- | --------------------------- | ---------------------------- | ------------- |
| DB-01   | Write queries must be explicitly allowed | `tools/db.js:classifyQuery` | `database-execution.test.js` | Fully covered |
| DB-02   | Result rows bounded to prevent OOM       | `tools/db.js:boundedRows`   | `database-execution.test.js` | Fully covered |
| DB-03   | TLS required for remote connections      | `tools/db.js`               | `database-security.test.js`  | Fully covered |

### 6. Deployment Rules

| Rule ID   | Rule                                 | Implementation                                 | Test                         | Status        |
| --------- | ------------------------------------ | ---------------------------------------------- | ---------------------------- | ------------- |
| DEPLOY-01 | Release manifests must be valid      | `lib/deployment.js:validateReleaseManifest`    | `deployment.test.js`         | Fully covered |
| DEPLOY-02 | Archive entries must not escape root | `lib/deployment.js:validateArchiveEntries`     | `deployment.test.js`         | Fully covered |
| DEPLOY-03 | GPG signatures must be verified      | `lib/deployment.js:validateSigningFingerprint` | `deployment.test.js`         | Fully covered |
| DEPLOY-04 | Environment files must be parseable  | `lib/deployment.js:parseEnvironment`           | `deployment.test.js`         | Fully covered |
| DEPLOY-05 | Deployment profiles must be valid    | `lib/deployment-profile.js`                    | `deployment-profile.test.js` | Fully covered |

### 7. Sandboxed Execution Rules

| Rule ID | Rule                                  | Implementation    | Test             | Status        |
| ------- | ------------------------------------- | ----------------- | ---------------- | ------------- |
| SAND-01 | Code runs in unprivileged container   | `tools/docker.js` | `docker.test.js` | Fully covered |
| SAND-02 | Resource limits applied (CPU, memory) | `tools/docker.js` | `docker.test.js` | Fully covered |
| SAND-03 | Network access denied by default      | `tools/docker.js` | `docker.test.js` | Fully covered |
| SAND-04 | Timeout kills container               | `tools/docker.js` | `docker.test.js` | Fully covered |

### 8. Job Queue Rules

| Rule ID | Rule                               | Implementation     | Test                | Status        |
| ------- | ---------------------------------- | ------------------ | ------------------- | ------------- |
| JOB-01  | Jobs are durable (survive restart) | `lib/job-queue.js` | `job-queue.test.js` | Fully covered |
| JOB-02  | Jobs expire after lease timeout    | `lib/job-queue.js` | `job-queue.test.js` | Fully covered |
| JOB-03  | Concurrent claims are prevented    | `lib/job-queue.js` | `job-queue.test.js` | Fully covered |
| JOB-04  | Failed jobs can be retried         | `lib/job-queue.js` | `job-queue.test.js` | Fully covered |

## Summary

- **Total business rules identified**: 35+
- **Rules with automated tests**: All
- **Rules with positive tests**: All
- **Rules with negative tests**: All authorization and security rules
