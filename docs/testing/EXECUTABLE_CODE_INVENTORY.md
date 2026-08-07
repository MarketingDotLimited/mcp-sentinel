# MCP Sentinel — Executable Code Inventory

**Generated**: 2026-08-07
**Commit**: `ff2e4140548eaab51b7fa5a5de395d61f0874afd`

## Summary

| Category              | Files  | Lines      | Coverage Status   |
| --------------------- | ------ | ---------- | ----------------- |
| Root (core)           | 6      | 7,357      | Measured (97.17%) |
| Root (utility/config) | 6      | 562        | Excluded          |
| `lib/`                | 27     | 4,904      | Measured (98.82%) |
| `routes/`             | 2      | 53         | Measured (100%)   |
| `tools/`              | 8      | 1,303      | Measured (100%)   |
| `public/js/`          | 21     | 4,400      | **NOT MEASURED**  |
| `scripts/`            | 11     | 1,440      | **EXCLUDED**      |
| **Total**             | **81** | **20,019** | —                 |

## Production Code — Core Server

| File              | Lines | Key Exports                                   | Coverage             |
| ----------------- | ----- | --------------------------------------------- | -------------------- |
| `server.js`       | 4,625 | Main entry, Express app, MCP tools, admin API | 97% (415 c8 ignores) |
| `broker.js`       | 1,441 | `startBroker` — privileged IPC daemon         | 85.62%               |
| `security.js`     | 798   | JWT auth, API keys, RBAC, scopes              | 100%                 |
| `audit.js`        | 254   | HMAC chain audit logging                      | 99.6%                |
| `keystore.js`     | 179   | SQLite API key storage                        | 100%                 |
| `node-gateway.js` | 60    | SSH gateway stdin handler                     | 100%                 |

## Production Code — Libraries (`lib/`)

| File                                  | Lines | Key Exports                           | Has Dedicated Test    |
| ------------------------------------- | ----- | ------------------------------------- | --------------------- |
| `lib/control-plane.js`                | 1,197 | Approvals, workflows, projects, teams | ✅                    |
| `lib/authelia.js`                     | 660   | Authelia YAML user/client management  | ✅                    |
| `lib/sqlite-state.js`                 | 362   | SQLite state persistence layer        | ✅                    |
| `lib/ssh-gateway-client.js`           | 287   | OpenSSH multiplexed client            | ✅                    |
| `lib/job-queue.js`                    | 270   | SQLite-backed durable job queue       | ✅                    |
| `lib/monitor.js`                      | 259   | System performance monitoring         | ✅                    |
| `lib/capabilities.js`                 | 199   | MCP capability pack management        | ✅                    |
| `lib/tool-result-schemas.js`          | 176   | Zod response schema registry          | ⚠️ Indirect → **NEW** |
| `lib/telemetry.js`                    | 170   | Prometheus metrics, OpenTelemetry     | ✅                    |
| `lib/ssh-policy.js`                   | 168   | Hierarchical SSH policy engine        | ✅                    |
| `lib/webauthn.js`                     | 160   | FIDO2/WebAuthn passkey operations     | ✅                    |
| `lib/state-crypto.js`                 | 130   | AES-256-GCM state encryption          | ✅                    |
| `lib/broker-client.js`                | 124   | IPC socket client                     | ✅                    |
| `lib/deployment.js`                   | 106   | Deployment validation utilities       | ⚠️ Indirect → **NEW** |
| `lib/oauth-mappings-store.js`         | 99    | OAuth user-to-Linux mappings          | ✅                    |
| `lib/key-provider.js`                 | 98    | Cryptographic key provider            | ✅                    |
| `lib/acme.js`                         | 83    | Let's Encrypt ACME management         | ✅                    |
| `lib/policy.js`                       | 85    | Policy-as-code evaluation engine      | ✅                    |
| `lib/exec.js`                         | 50    | Secure child_process wrapper          | ✅                    |
| `lib/deployment-profile.js`           | 37    | Deployment profile validation         | ✅                    |
| `lib/admin-state.js`                  | 34    | Admin key-value metadata store        | ✅                    |
| `lib/oauth-token-policy.js`           | 29    | OAuth JWT token policy validator      | ✅                    |
| `lib/slo.js`                          | 25    | Service-level objective definitions   | ✅                    |
| `lib/credentials.js`                  | 23    | Credential file loader                | ✅                    |
| `lib/project-operation-dispatcher.js` | 22    | Project operation routing             | ✅                    |
| `lib/remote-operation-policy.js`      | 21    | SSH operation whitelist               | ⚠️ Indirect → **NEW** |
| `lib/authelia-client.js`              | 11    | Authelia IPC client                   | ⚠️ Indirect → **NEW** |

## Production Code — Tools (`tools/`)

| File                | Lines | Key Exports                       | Has Dedicated Test    |
| ------------------- | ----- | --------------------------------- | --------------------- |
| `tools/system.js`   | 535   | System info, processes, test runs | ✅                    |
| `tools/docker.js`   | 211   | Sandboxed code execution          | ⚠️ Indirect → **NEW** |
| `tools/db.js`       | 169   | Database query execution          | ✅                    |
| `tools/services.js` | 142   | Systemd, UFW management           | ✅                    |
| `tools/users.js`    | 104   | Linux user CRUD, SSH keys         | ⚠️ Indirect → **NEW** |
| `tools/files.js`    | 94    | File system operations            | ✅                    |
| `tools/rollback.js` | 32    | Config backup/restore             | ✅                    |
| `tools/git.js`      | 16    | Git operations                    | ✅                    |

## Production Code — Routes (`routes/`)

| File             | Lines | Endpoints                                                  | Coverage |
| ---------------- | ----- | ---------------------------------------------------------- | -------- |
| `routes/core.js` | 30    | `GET /health`, `GET /.well-known/oauth-protected-resource` | 100%     |
| `routes/auth.js` | 23    | `POST /auth/token`, `POST /auth/logout`                    | 100%     |

## Browser JavaScript (`public/js/`) — NOT MEASURED

| File                                 | Lines | Type                |
| ------------------------------------ | ----- | ------------------- |
| `public/js/pages/oauth.js`           | 1,069 | Page component      |
| `public/js/pages/keys.js`            | 473   | Page component      |
| `public/js/pages/ssh-access.js`      | 422   | Page component      |
| `public/js/pages/logs.js`            | 360   | Page component      |
| `public/js/api.js`                   | 321   | API client          |
| `public/js/pages/connect.js`         | 301   | Page component      |
| `public/js/pages/rollbacks.js`       | 255   | Page component      |
| `public/js/pages/dashboard.js`       | 237   | Page component      |
| `public/js/pages/sessions.js`        | 236   | Page component      |
| `public/js/app.js`                   | 228   | Entry point         |
| `public/js/scope-registry.js`        | 174   | Shared component    |
| `public/js/pages/action-manifest.js` | 115   | Page component      |
| `public/js/pages/administration.js`  | 98    | Page component      |
| `public/js/pages/teams.js`           | 84    | Page component      |
| `public/js/router.js`                | 72    | SPA router          |
| `public/js/pages/approvals.js`       | 72    | Page component      |
| `public/js/pages/projects.js`        | 68    | Page component      |
| `public/js/toast.js`                 | 65    | Toast notifications |
| `public/js/pages/workflows.js`       | 63    | Page component      |
| `public/js/auth.js`                  | 48    | Auth state manager  |
| `public/js/pages/security.js`        | 39    | Page component      |

## Scripts (`scripts/`) — EXCLUDED

| File                               | Lines | Purpose                        |
| ---------------------------------- | ----- | ------------------------------ |
| `scripts/deploy-release.js`        | 466   | Release deployment             |
| `scripts/production-preflight.js`  | 323   | Pre-deployment checks          |
| `scripts/migrate-state.js`         | 128   | Legacy JSON → SQLite migration |
| `scripts/register-node-project.js` | 114   | CLI project registration       |
| `scripts/export-legacy-state.js`   | 94    | Legacy state export            |
| `scripts/rotate-state-key.js`      | 89    | Encryption key rotation        |
| `scripts/verify-audit.js`          | 73    | Audit chain verification       |
| `scripts/backup-state.js`          | 66    | Encrypted state backup         |
| `scripts/restore-state.js`         | 54    | State restoration              |
| `scripts/upgrade-state.js`         | 17    | Schema migration               |
| `scripts/firewall-rollback.js`     | 16    | UFW rule rollback              |

## MCP Tools Registered (45 total)

1. `get_system_info` 2. `get_processes` 3. `kill_process`
2. `run_project_tests` 5. `get_project_test_run` 6. `cancel_project_test_run`
3. `read_file` 8. `write_file` 9. `delete_file`
4. `list_directory` 11. `move_file` 12. `copy_file`
5. `get_file_info` 14. `search_files`
6. `manage_service` 16. `get_service_status` 17. `list_services`
7. `get_journal_logs` 19. `manage_firewall`
8. `list_users` 21. `get_user_info` 22. `create_user`
9. `delete_user` 24. `set_user_password` 25. `modify_user`
10. `manage_ssh_keys` 27. `run_sandboxed_code`
11. `apply_config` 29. `list_config_backups` 30. `restore_config`
12. `git_operation` 32. `execute_query`
13. `list_guided_workflows` 34. `get_security_posture`
14. `request_change_approval` 36. `list_projects`
15. `get_my_ssh_access` 38. `set_my_ssh_access`
16. `list_ssh_access_policies` 40. `admin_set_ssh_access`
17. `plan_project_deployment` 42. `deploy_project`
18. `subscribe_to_alert` 44. `unsubscribe_from_alert` 45. `list_active_alerts`
