# MCP Sentinel — User Journey Matrix

## Journey Families

### 1. Authentication & Session

| Journey               | Persona    | Tests                                   | Happy | Failure | Auth | Status        |
| --------------------- | ---------- | --------------------------------------- | ----- | ------- | ---- | ------------- |
| Login with password   | Admin      | `routes-auth.test.js`, `ui-e2e.test.js` | ✅    | ✅      | N/A  | Fully covered |
| Login with WebAuthn   | Admin      | `webauthn.test.js`                      | ✅    | ✅      | N/A  | Fully covered |
| Login with API key    | Operator   | `security-auth.test.js`                 | ✅    | ✅      | N/A  | Fully covered |
| Login with OAuth/OIDC | OAuth user | `security-oidc.test.js`                 | ✅    | ✅      | N/A  | Fully covered |
| Session expiration    | Any        | `security-auth.test.js`                 | ✅    | ✅      | ✅   | Fully covered |
| Logout                | Any        | `routes-auth.test.js`                   | ✅    | ✅      | ✅   | Fully covered |

### 2. Dashboard & System Health

| Journey             | Persona | Tests                               | Happy | Failure | Status        |
| ------------------- | ------- | ----------------------------------- | ----- | ------- | ------------- |
| View dashboard      | Admin   | `ui-e2e.test.js`, `monitor.test.js` | ✅    | ✅      | Fully covered |
| View system info    | Admin   | `system.test.js`                    | ✅    | ✅      | Fully covered |
| View processes      | Admin   | `system.test.js`                    | ✅    | ✅      | Fully covered |
| Subscribe to alerts | Admin   | `monitor.test.js`                   | ✅    | ✅      | Fully covered |

### 3. User Management

| Journey         | Persona | Tests                                     | Happy | Failure | Status        |
| --------------- | ------- | ----------------------------------------- | ----- | ------- | ------------- |
| List users      | Admin   | `users.test.js`, `broker-missing.test.js` | ✅    | ✅      | Fully covered |
| Create user     | Admin   | `users.test.js`, `broker-missing.test.js` | ✅    | ✅      | Fully covered |
| Delete user     | Admin   | `users.test.js`, `broker-missing.test.js` | ✅    | ✅      | Fully covered |
| Manage SSH keys | Admin   | `users.test.js`, `broker-missing.test.js` | ✅    | ✅      | Fully covered |

### 4. Service Management

| Journey            | Persona | Tests                    | Happy | Failure | Status        |
| ------------------ | ------- | ------------------------ | ----- | ------- | ------------- |
| List services      | Admin   | `tools-services.test.js` | ✅    | ✅      | Fully covered |
| Start/stop service | Admin   | `tools-services.test.js` | ✅    | ✅      | Fully covered |
| View service logs  | Admin   | `tools-services.test.js` | ✅    | ✅      | Fully covered |

### 5. Firewall Management

| Journey              | Persona | Tests                    | Happy | Failure | Status        |
| -------------------- | ------- | ------------------------ | ----- | ------- | ------------- |
| List firewall rules  | Admin   | `tools-services.test.js` | ✅    | ✅      | Fully covered |
| Add firewall rule    | Admin   | `tools-services.test.js` | ✅    | ✅      | Fully covered |
| Remove firewall rule | Admin   | `tools-services.test.js` | ✅    | ✅      | Fully covered |

### 6. File Operations

| Journey      | Persona  | Tests           | Happy | Failure | Status        |
| ------------ | -------- | --------------- | ----- | ------- | ------------- |
| Read file    | Operator | `files.test.js` | ✅    | ✅      | Fully covered |
| Write file   | Operator | `files.test.js` | ✅    | ✅      | Fully covered |
| Delete file  | Operator | `files.test.js` | ✅    | ✅      | Fully covered |
| Search files | Operator | `files.test.js` | ✅    | ✅      | Fully covered |

### 7. Database Operations

| Journey              | Persona | Tests                        | Happy | Failure | Status        |
| -------------------- | ------- | ---------------------------- | ----- | ------- | ------------- |
| Execute query        | DBA     | `database-execution.test.js` | ✅    | ✅      | Fully covered |
| Query classification | DBA     | `database-execution.test.js` | ✅    | ✅      | Fully covered |

### 8. Git & Deployment

| Journey         | Persona   | Tests                     | Happy | Failure | Status        |
| --------------- | --------- | ------------------------- | ----- | ------- | ------------- |
| Git operations  | Developer | `tools-git.test.js`       | ✅    | ✅      | Fully covered |
| Plan deployment | Developer | `server-coverage.test.js` | ✅    | ✅      | Fully covered |
| Deploy project  | Developer | `server-coverage.test.js` | ✅    | ✅      | Fully covered |
| Rollback config | Admin     | `tools-rollback.test.js`  | ✅    | ✅      | Fully covered |

### 9. Security Management

| Journey               | Persona  | Tests                                             | Happy | Failure | Status        |
| --------------------- | -------- | ------------------------------------------------- | ----- | ------- | ------------- |
| View security posture | Security | `security-coverage.test.js`                       | ✅    | ✅      | Fully covered |
| Manage API keys       | Admin    | `keystore.test.js`, `key-provider.test.js`        | ✅    | ✅      | Fully covered |
| Manage SSH access     | Admin    | `ssh-policy.test.js`, `ssh-control-plane.test.js` | ✅    | ✅      | Fully covered |
| Request approval      | Operator | `control-plane.test.js`                           | ✅    | ✅      | Fully covered |

### 10. OAuth Administration

| Journey              | Persona | Tests                                                    | Happy | Failure | Status        |
| -------------------- | ------- | -------------------------------------------------------- | ----- | ------- | ------------- |
| Manage OAuth users   | Admin   | `security-oidc.test.js`, `authelia-broker-state.test.js` | ✅    | ✅      | Fully covered |
| Manage OAuth clients | Admin   | `security-oidc.test.js`                                  | ✅    | ✅      | Fully covered |
| OAuth diagnostics    | Admin   | `security-oidc.test.js`                                  | ✅    | ✅      | Fully covered |

### 11. Sandboxed Code Execution

| Journey                | Persona   | Tests                                       | Happy | Failure | Status        |
| ---------------------- | --------- | ------------------------------------------- | ----- | ------- | ------------- |
| Run Python in sandbox  | Developer | `docker.test.js`, `sandbox-runtime.test.js` | ✅    | ✅      | Fully covered |
| Run Node.js in sandbox | Developer | `docker.test.js`, `sandbox-runtime.test.js` | ✅    | ✅      | Fully covered |

### 12. UI Navigation (Browser)

| Journey               | Persona | Tests            | Status        |
| --------------------- | ------- | ---------------- | ------------- |
| Navigate to dashboard | Admin   | `ui-e2e.test.js` | Fully covered |
| Navigate to workflows | Admin   | `ui-e2e.test.js` | Fully covered |
| Navigate to admin     | Admin   | `ui-e2e.test.js` | Fully covered |
| Navigate to connect   | Admin   | `ui-e2e.test.js` | Fully covered |

## Summary

- **Total journey families**: 12
- **Total journeys**: 40+
- **Journeys with happy path**: All
- **Journeys with failure path**: All
- **Journeys with auth verification**: All admin journeys
