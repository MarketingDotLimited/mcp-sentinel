# Changelog

All notable changes to MCP Sentinel will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-07-22

### 🔒 Security Update

This release implements a comprehensive 10-phase security remediation plan to harden the server architecture, enforce privilege separation, and eliminate critical vulnerabilities.

#### Changed / Fixed

- **Phase 1: CI/CD Supply Chain** — Pinned GitHub actions to SHAs, removed self-hosted runner risks, added strict `npm audit`.
- **Phase 2: Configuration Validation** — Server now fail-closes on placeholder secrets or invalid configurations.
- **Phase 3: Privilege Separation** — Non-admin tools now rigorously execute as the mapped UNIX `userId` instead of root.
- **Phase 4: Filesystem Sandbox** — Hardened path resolution with strict `realpath` checks against symlink escapes and isolated per-user `/tmp` directories.
- **Phase 5: User/SSH Management** — Protected reserved system users, mitigated `chpasswd` injection, and isolated SSH key operations.
- **Phase 6: Networking & Limits** — Added robust IPv4/IPv6 CIDR checking via `ipaddr.js`, explicit `TRUSTED_PROXIES` configurations, global and per-user session limits.
- **Phase 7: Persistent Key Management** — Keys are now SHA-256 hashed and stored in `keys.json`. JWTs now support instant revocation and key version checking.
- **Phase 8: Process & Service Hardening** — Removed dangerous generic `run_command` tool. Added strict input validation and UID verification for signals.
- **Phase 9: Audit & Crash Resilience** — Audit logs are now tamper-evident (hash chains), strictly `0o600` permissions, and scrubbed of passwords/secrets. Added robust Express error handlers.
- **Phase 10: Docs & Tests** — Automated validation smoke tests added. Documentation updated to reflect true architectural boundaries.

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

[1.1.0]: https://github.com/MarketingDotLimited/mcp-sentinel/releases/tag/v1.1.0
[1.0.0]: https://github.com/MarketingDotLimited/mcp-sentinel/releases/tag/v1.0.0
