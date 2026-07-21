# MCP Sentinel 🛡️

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/MarketingDotLimited/mcp-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/MarketingDotLimited/mcp-sentinel/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-HTTP%2FSSE-blue)](https://modelcontextprotocol.io)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A **production-grade MCP (Model Context Protocol) server** that lets AI cloud services (Claude, ChatGPT, Gemini, Cursor, etc.) control and manage your Linux server securely via HTTP/SSE.

## ✨ Features

- **24 MCP Tools** — run commands, manage files, control services, manage users & SSH keys
- **Multi-Layer Security** — API key + JWT tokens + IP whitelist + rate limiting + audit logs + path sandboxing + scope enforcement + HTTPS + Helmet + CORS
- **Role-Based Access** — `admin` gets full control; `user` is sandboxed to their home directory
- **Per-User API Keys** — issue scoped keys for different users/services
- **Audit Logging** — every tool call logged with user, IP, duration, result (daily rotating JSON)
- **systemd Ready** — auto-start on boot

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/MarketingDotLimited/mcp-sentinel.git
cd mcp-sentinel

# 2. Install dependencies
npm install

# 3. Setup (generates secrets, .env, optional TLS cert)
node setup.js

# 4. Start
npm start

# 5. Or run as system service
cp mcp-server.service /etc/systemd/system/
systemctl enable --now mcp-server
```

## 🔗 Connect Your AI Client

### Claude Desktop
```json
{
  "mcpServers": {
    "server-control": {
      "type": "sse",
      "url": "http://YOUR_SERVER_IP:4444/mcp",
      "headers": { "X-API-Key": "YOUR_ADMIN_KEY" }
    }
  }
}
```

### Cursor / VS Code
```json
{
  "mcpServers": {
    "server-control": {
      "url": "http://YOUR_SERVER_IP:4444/mcp",
      "type": "sse",
      "headers": { "X-API-Key": "YOUR_ADMIN_KEY" }
    }
  }
}
```

## 🛠️ Available Tools

| Category | Tools |
|---|---|
| **System** | `run_command`, `get_system_info`, `get_processes`, `kill_process` |
| **Files** | `read_file`, `write_file`, `delete_file`, `list_directory`, `move_file`, `copy_file`, `get_file_info`, `search_files` |
| **Services** | `manage_service`, `get_service_status`, `list_services`, `get_journal_logs`, `manage_firewall` |
| **Users** | `list_users`, `get_user_info`, `create_user`, `delete_user`, `set_user_password`, `modify_user`, `manage_ssh_keys` |

## 🔐 Security Architecture

```
AI Client → HTTPS → IP Whitelist → API Key/JWT → Rate Limit → Scope Check → Sandbox → Tool
```

| Layer | Details |
|---|---|
| **HTTPS/TLS** | TLS 1.2+ with strong cipher suites |
| **IP Whitelist** | Per-key or global CIDR restrictions (IPv4) |
| **API Key** | 32-byte cryptographically random hex keys |
| **JWT Tokens** | HS256-signed, IP-bound, 8h expiry |
| **Rate Limiting** | 60 req/min global, 10/15min auth |
| **Scope Enforcement** | Per-key tool access control |
| **Path Sandbox** | Users restricted to `/home/{username}`, symlink-safe |
| **Audit Logs** | Structured JSON, 30-day retention, sensitive fields redacted |

## 📁 Project Structure

```
├── server.js              # Main MCP server (Express + SSE)
├── security.js            # All auth & security middleware
├── audit.js               # Structured audit logging
├── keygen.js              # API key generator
├── setup.js               # First-time setup wizard
├── mcp-server.service     # systemd unit file
├── .env.example           # Config template
└── tools/
    ├── system.js          # Shell commands, processes, system info
    ├── files.js           # File system CRUD
    ├── services.js        # systemd & firewall management
    └── users.js           # User & SSH key management
```

## ⚙️ Configuration

Copy `.env.example` to `.env` and configure:

```env
PORT=4444
USE_HTTPS=true
JWT_SECRET=<64-byte random hex>
ADMIN_API_KEY=<generated with keygen.js>
ALLOWED_IPS=203.0.113.10,192.168.1.0/24   # optional
RATE_LIMIT_MAX_REQUESTS=60
AUDIT_LOG_KEEP_DAYS=30
```

## 🔑 Generate API Keys

```bash
# Generate admin key
node keygen.js admin admin

# Generate scoped user key
node keygen.js alice user run_command,read_file,write_file
```

## 📊 Monitor

```bash
# Live audit log
tail -f logs/audit-$(date +%Y-%m-%d).log | jq

# View active sessions
curl http://localhost:4444/admin/sessions -H "X-API-Key: YOUR_KEY"

# Health check
curl http://localhost:4444/health
```

## Requirements

- Node.js 18+
- Linux (systemd-based)
- `openssl` (for HTTPS)
- Root or sudo for full admin tools

---

## Contributing

Contributions are very welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:
- Development setup
- Adding new MCP tools
- Submitting pull requests

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Security

Found a vulnerability? Please read [SECURITY.md](SECURITY.md) and report privately — do not open a public issue.

## License

[MIT](LICENSE) © 2026 [MarketingDotLimited](https://github.com/MarketingDotLimited)
