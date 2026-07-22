# Changelog

All notable changes to MCP Sentinel will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] — 2026-07-23

### Security architecture release

- Runs the public service unprivileged and routes registered privileged operations through a closed, typed Unix-socket broker.
- Requires UUID project registration for project files, Git recipes, and test recipes; removes path-based compatibility inputs.
- Adds durable SQLite WAL state, encrypted verified backups, transactional migrations, OAuth authorization versions, persistent revocation, and HMAC-chained audit verification.
- Adds structured project-test run, status, and cancellation tools with bounded output and testing-environment enforcement.
- Removes the 1.x automation, fleet, backup-target, and webhook APIs, MCP tools, dashboard pages, code, and tables. Non-empty legacy tables require a matching verified offline export before migration.
- Adds scope-filtered manifests, Streamable HTTP and SSE list-change notifications, pinned CI actions, secret scanning, release coverage gates, and production deployment/rollback instructions.

## [1.1.0] — 2026-07-22

### 🔒 Security Update

This compatibility release implements the code-side containment and migration boundary required before the 2.0 removal release. Credential rotation, Git history purging, production migration, and ChatGPT action refresh remain explicit operator gates.

#### Changed / Fixed

- **Phase 1: CI/CD Supply Chain** — Pinned GitHub actions to SHAs, removed self-hosted runner risks, added strict `npm audit`.
- **Phase 2: Configuration Validation** — Server now fail-closes on placeholder secrets or invalid configurations.
- **Privilege Separation** — Added a closed-protocol Unix-socket broker, hardened root/public systemd units, protected service and firewall allow-lists, and broker-owned transient project test units.
- **Phase 4: Filesystem Sandbox** — Hardened path resolution with strict `realpath` checks against symlink escapes and isolated per-user `/tmp` directories.
- **Phase 5: User/SSH Management** — Protected reserved system users, mitigated `chpasswd` injection, and isolated SSH key operations.
- **Phase 6: Networking & Limits** — Added robust IPv4/IPv6 CIDR checking via `ipaddr.js`, explicit `TRUSTED_PROXIES` configurations, global and per-user session limits.
- **Persistent State** — Added versioned SQLite WAL storage, idempotent legacy JSON/project migration, encrypted-secret key IDs, durable test-run results, persistent JWT revocation, and protected systemd credentials.
- **Phase 8: Process & Service Hardening** — Removed dangerous generic `run_command` tool. Added strict input validation and UID verification for signals.
- **OAuth and approvals** — Enforced exact RS256 issuer/resource audience/client checks, explicit client mappings, authorization versions, four-eyes approval, canonical single-use request hashes, bounded previews, and decision history.
- **MCP contract** — Added registry-only project test recipes, status/cancel tools, structured output schemas, scope-filtered discovery, manifest hashing, action refresh instructions, and tool-list change notifications.
- **Audit & crash resilience** — Replaced the resettable digest with a checkpointed HMAC chain, added daily verification units, retained explicit `externallyAnchored: false` posture, and scrubbed sensitive arguments.
- **Repository containment** — Removed live Authelia state, signing keys, backups, databases, and coverage from tracking; added sanitized templates and a credential/history-purge runbook.

---

## [1.0.0] — 2026-07-21

### 🎉 Initial Release

#### Added

- **HTTP/SSE MCP transport** — accessible by any AI cloud service (Claude, ChatGPT, Gemini, Cursor, etc.)
- **20 MCP tools** across 4 categories:
  - **System**: `run_command`, `get_system_info`, `get_processes`, `kill_process`
  - **Files**: `read_file`, `write_file`, `delete_file`, `list_directory`, `move_file`, `copy_file`, `get_file_info`, `search_files`
  - **Services**: `manage_service`, `get_service_status`, `list_services`, `get_journal_logs`, `manage_firewall`
  - **Users**: `list_users`, `get_user_info`, `create_user`, `delete_user`, `set_user_password`, `modify_user`, `manage_ssh_keys`
- **8-layer security model**:
  - API key authentication (`X-API-Key` header)
  - JWT session tokens (IP-bound, 8h expiry)
  - Global and per-key IP whitelist (CIDR support)
  - Rate limiting (60 req/min global, 10/15min auth)
  - Helmet.js security headers (CSP, HSTS, XSS protection)
  - CORS protection with configurable allowed origins
  - Command blacklist (regex patterns for destructive commands)
  - Path sandboxing (users restricted to `/home/{username}`)
  - Role-based access control (`admin` / `user`)
  - Scope-based API key authorization
- **Daily rotating audit logs** — JSON structured, 30-day retention, auto-compressed
- **Per-session MCP server instances** — isolated per connection
- **Admin API endpoints** — key management, session listing
- **HTTPS support** — TLS 1.2+ with configurable cert paths
- **systemd service unit** — auto-start on boot
- **First-time setup wizard** (`node setup.js`) — generates secrets and TLS certs
- **API key generator** (`node keygen.js`) — cryptographically secure 32-byte keys
- **Graceful shutdown** — SIGTERM/SIGINT handling

[2.0.0]: https://github.com/MarketingDotLimited/mcp-sentinel/releases/tag/v2.0.0
[1.1.0]: https://github.com/MarketingDotLimited/mcp-sentinel/releases/tag/v1.1.0
[1.0.0]: https://github.com/MarketingDotLimited/mcp-sentinel/releases/tag/v1.0.0
