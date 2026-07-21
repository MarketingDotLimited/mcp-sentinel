# Changelog

All notable changes to MCP Sentinel will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/MarketingDotLimited/mcp-sentinel/releases/tag/v1.0.0
