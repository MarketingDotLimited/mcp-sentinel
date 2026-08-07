# MCP Sentinel — API Route Matrix

This matrix maps every HTTP API route to its implementation, authentication
requirements, and test coverage.

## Authentication Routes

| Method | Path           | Handler          | Auth                      | Tests                 | Status        |
| ------ | -------------- | ---------------- | ------------------------- | --------------------- | ------------- |
| POST   | `/auth/token`  | `routes/auth.js` | Rate-limited, credentials | `routes-auth.test.js` | Fully covered |
| POST   | `/auth/logout` | `routes/auth.js` | JWT required              | `routes-auth.test.js` | Fully covered |

## Core Routes

| Method | Path                                    | Handler          | Auth | Tests                 | Status        |
| ------ | --------------------------------------- | ---------------- | ---- | --------------------- | ------------- |
| GET    | `/health`                               | `routes/core.js` | None | `routes-core.test.js` | Fully covered |
| GET    | `/.well-known/oauth-protected-resource` | `routes/core.js` | None | `routes-core.test.js` | Fully covered |

## WebAuthn Routes

| Method | Path                               | Auth      | Tests              | Status        |
| ------ | ---------------------------------- | --------- | ------------------ | ------------- |
| POST   | `/admin/webauthn/register/options` | Admin JWT | `webauthn.test.js` | Fully covered |
| POST   | `/admin/webauthn/register/verify`  | Admin JWT | `webauthn.test.js` | Fully covered |
| GET    | `/admin/webauthn/credentials`      | Admin JWT | `webauthn.test.js` | Fully covered |
| POST   | `/auth/webauthn/options`           | None      | `webauthn.test.js` | Fully covered |
| POST   | `/auth/webauthn/verify`            | None      | `webauthn.test.js` | Fully covered |

## Admin Observability Routes

| Method | Path                      | Auth        | Tests                             | Status        |
| ------ | ------------------------- | ----------- | --------------------------------- | ------------- |
| GET    | `/metrics`                | API Key/JWT | `telemetry.test.js`               | Fully covered |
| GET    | `/admin/metrics`          | Admin       | `telemetry.test.js`               | Fully covered |
| GET    | `/admin/slo`              | Admin       | `slo.test.js`                     | Fully covered |
| GET    | `/admin/stats`            | Admin       | `server-coverage.test.js`         | Fully covered |
| GET    | `/admin/policy-status`    | Admin       | `policy.test.js`                  | Fully covered |
| GET    | `/admin/security-posture` | Admin       | `security-coverage.test.js`       | Fully covered |
| GET    | `/admin/broker-status`    | Admin       | `admin-broker-dependency.test.js` | Fully covered |
| GET    | `/admin/policy/simulate`  | Admin       | `policy-simulator.test.js`        | Fully covered |

## Job Queue Routes

| Method | Path                       | Auth  | Tests               | Status        |
| ------ | -------------------------- | ----- | ------------------- | ------------- |
| GET    | `/admin/jobs`              | Admin | `job-queue.test.js` | Fully covered |
| POST   | `/admin/jobs`              | Admin | `job-queue.test.js` | Fully covered |
| POST   | `/admin/jobs/claim`        | Admin | `job-queue.test.js` | Fully covered |
| GET    | `/admin/jobs/:id`          | Admin | `job-queue.test.js` | Fully covered |
| POST   | `/admin/jobs/:id/cancel`   | Admin | `job-queue.test.js` | Fully covered |
| POST   | `/admin/jobs/:id/complete` | Admin | `job-queue.test.js` | Fully covered |
| POST   | `/admin/jobs/:id/fail`     | Admin | `job-queue.test.js` | Fully covered |

## API Key Routes

| Method | Path                 | Auth  | Tests                                      | Status        |
| ------ | -------------------- | ----- | ------------------------------------------ | ------------- |
| POST   | `/admin/keys`        | Admin | `key-provider.test.js`, `keystore.test.js` | Fully covered |
| POST   | `/admin/keys/revoke` | Admin | `keystore.test.js`                         | Fully covered |
| GET    | `/admin/keys`        | Admin | `keystore.test.js`                         | Fully covered |
| PUT    | `/admin/keys/:id`    | Admin | `keystore.test.js`                         | Fully covered |

## Workflow & Approval Routes

| Method | Path                   | Auth  | Tests                   | Status        |
| ------ | ---------------------- | ----- | ----------------------- | ------------- |
| GET    | `/admin/workflows`     | Admin | `control-plane.test.js` | Fully covered |
| GET    | `/admin/approvals`     | Admin | `control-plane.test.js` | Fully covered |
| POST   | `/admin/approvals/:id` | Admin | `control-plane.test.js` | Fully covered |

## Project & SSH Routes

| Method | Path                | Auth  | Tests                       | Status        |
| ------ | ------------------- | ----- | --------------------------- | ------------- |
| GET    | `/admin/projects`   | Admin | `control-plane.test.js`     | Fully covered |
| POST   | `/admin/projects`   | Admin | `control-plane.test.js`     | Fully covered |
| GET    | `/me/ssh-access`    | JWT   | `ssh-control-plane.test.js` | Fully covered |
| PUT    | `/me/ssh-access`    | JWT   | `ssh-control-plane.test.js` | Fully covered |
| GET    | `/admin/ssh-access` | Admin | `ssh-control-plane.test.js` | Fully covered |
| PUT    | `/admin/ssh-access` | Admin | `ssh-control-plane.test.js` | Fully covered |

## OAuth Routes

| Method | Path                             | Auth  | Tests                   | Status        |
| ------ | -------------------------------- | ----- | ----------------------- | ------------- |
| GET    | `/admin/oauth-users`             | Admin | `security-oidc.test.js` | Fully covered |
| POST   | `/admin/oauth-users`             | Admin | `security-oidc.test.js` | Fully covered |
| PUT    | `/admin/oauth-users/:username`   | Admin | `security-oidc.test.js` | Fully covered |
| DELETE | `/admin/oauth-users/:username`   | Admin | `security-oidc.test.js` | Fully covered |
| GET    | `/admin/oauth-clients`           | Admin | `security-oidc.test.js` | Fully covered |
| POST   | `/admin/oauth-clients`           | Admin | `security-oidc.test.js` | Fully covered |
| DELETE | `/admin/oauth-clients/:clientId` | Admin | `security-oidc.test.js` | Fully covered |

## Session Routes

| Method | Path                  | Auth  | Tests                     | Status        |
| ------ | --------------------- | ----- | ------------------------- | ------------- |
| DELETE | `/admin/sessions/:id` | Admin | `server-coverage.test.js` | Fully covered |
| DELETE | `/admin/sessions`     | Admin | `server-coverage.test.js` | Fully covered |

## MCP Endpoint

| Method | Path           | Auth              | Tests                                      | Status        |
| ------ | -------------- | ----------------- | ------------------------------------------ | ------------- |
| ALL    | `/mcp`         | API Key/JWT/OAuth | `server-coverage.test.js`, `smoke.test.js` | Fully covered |
| ALL    | `/mcp/message` | API Key/JWT/OAuth | `server-coverage.test.js`                  | Fully covered |

## SPA Fallback

| Method | Path       | Auth               | Tests            | Status        |
| ------ | ---------- | ------------------ | ---------------- | ------------- |
| GET    | `/admin`   | None (serves HTML) | `ui-e2e.test.js` | Fully covered |
| GET    | `/admin/*` | None (serves HTML) | `ui-e2e.test.js` | Fully covered |

## Summary

- **Total API routes**: ~60+
- **Routes with tests**: All
- **Routes with auth tests**: All admin routes
- **Untested routes**: 0
