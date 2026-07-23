# MCP Sentinel 🛡️

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/MarketingDotLimited/mcp-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/MarketingDotLimited/mcp-sentinel/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-HTTP%2FSSE-blue)](https://modelcontextprotocol.io)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A **security-hardened MCP (Model Context Protocol) server** that lets AI cloud services (Claude, ChatGPT, Gemini, Cursor, etc.) control and manage your Linux server securely via Streamable HTTP.

## ✨ Features

- **Guided defaults** — Server Care and Developer Work make safe server management and AI-assisted development approachable from any MCP-compatible platform
- **Multi-Layer Security** — API key + JWT tokens + IP whitelist + rate limiting + audit logs + path sandboxing + scope enforcement + HTTPS + Helmet + CORS
- **Role-Based Access** — `admin` gets full control; `user` is sandboxed to their home directory
- **Per-User API Keys** — issue scoped keys for different users/services
- **Audit Logging** — every tool call logged with user, IP, duration, result (daily rotating JSON)
- **Approval Control Plane** — optionally require a human administrator to approve exact high-risk AI actions before they run
- **Guided Workflows** — plain-language diagnostics, security review, and development prompts for any MCP-compatible AI
- **Project Registry** — register approved repositories and generate safe deployment plans for developers and AI coding agents
- **Managed SSH Nodes** — optional multi-host project operations through pinned, forced-command, typed gateways; disabled by default
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

# 5. Production uses the hardened public service plus typed root broker.
# Follow docs/REMEDIATION.md; do not deploy from this checkout as root.
```

## 🔗 Connect Your AI Client

The web dashboard now includes **Connect AI**, which provides the current endpoint and a platform-neutral configuration snippet. Create a scoped key for each AI client and enable approval mode for agents that can make changes.

> **Note:** The examples use `https://`. HTTPS is **required** for production use to protect your credentials and data.

### Claude Desktop

```json
{
  "mcpServers": {
    "server-control": {
      "type": "sse",
      "url": "https://YOUR_SERVER_IP:4444/mcp",
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
      "url": "https://YOUR_SERVER_IP:4444/mcp",
      "type": "sse",
      "headers": { "X-API-Key": "YOUR_ADMIN_KEY" }
    }
  }
}
```

## 🛠️ Available Tools

| Category                           | Tools                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| **Server Care (default)**          | health, services, logs, safe configuration changes, approvals, and audit review        |
| **Developer Work (default)**       | approved project inspection, constrained file work, Git operations, and targeted tests |
| **Advanced System Administration** | users, SSH keys, firewall rules, and process signals; disabled by default              |
| **Advanced Data Access**           | raw SQL against configured aliases; disabled by default                                |
| **Advanced Execution**             | sandbox execution and direct deployment; disabled by default                           |

## 🔐 Security Architecture

```
AI Client → HTTPS proxy → unprivileged Sentinel → scope/policy/approval → local broker or pinned SSH node gateway
```

| Layer                    | Details                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| **HTTPS/TLS**            | TLS 1.2+ with strong cipher suites                                                        |
| **Privilege Separation** | Public service is unprivileged; registered root operations use a typed Unix-socket broker |
| **IP Whitelist**         | Per-key or global CIDR restrictions (IPv4 & IPv6)                                         |
| **API Key**              | Persistently stored, SHA-256 hashed                                                       |
| **JWT Tokens**           | HS256-signed, revocable, short-lived bearer with issuing-IP anomaly detection             |
| **Rate & Session Limit** | Global, auth limits, and concurrent session capping                                       |
| **Scope Enforcement**    | Per-key tool access control                                                               |
| **Path Sandbox**         | Symlink-safe, users restricted to `/home/{username}` and private temp dirs                |
| **Audit Logs**           | Tamper-evident structured JSON with secret redaction                                      |
| **SSH Nodes**            | Any-deny policy layers, pinned host keys, forced commands, no shell/TTY/forwarding/SFTP   |

## 📁 Project Structure

```
├── server.js              # Main MCP server (Express + Streamable HTTP)
├── security.js            # All auth & security middleware
├── audit.js               # Structured audit logging
├── keygen.js              # API key generator
├── setup.js               # First-time setup wizard
├── broker.js              # closed-protocol root privilege broker
├── deploy/                # hardened systemd units and broker allow-list template
├── .env                   # generated by setup.js; never commit this file
└── tools/
    ├── system.js          # Shell commands, processes, system info
    ├── files.js           # File system CRUD
    ├── services.js        # systemd & firewall management
    └── users.js           # User & SSH key management
```

## ⚙️ Configuration

Run `node setup.js` to create `.env`, then configure it as needed:

```env
PORT=4444
USE_HTTPS=true
JWT_SECRET=<64-byte random hex>
ADMIN_API_KEY=<generated with keygen.js>
ALLOWED_IPS=203.0.113.10,192.168.1.0/24   # optional
RATE_LIMIT_MAX_REQUESTS=60
AUDIT_LOG_KEEP_DAYS=30

# Optional Authelia/OIDC bearer-token support. Both must be set together and
# the JWKS endpoint must present a certificate trusted by Node.js.
AUTHELIA_ISSUER=https://auth.example.com
AUTHELIA_JWKS_URL=https://auth.example.com/jwks.json
OAUTH_RESOURCE_URL=https://mcp.example.com

# SQLite control-plane storage and project allow-lists
MCP_STATE_DB=/var/lib/mcp-sentinel/state.sqlite3
GIT_ALLOWED_REPOS=/srv/my-app,/srv/another-app
PROJECT_ALLOWED_ROOTS=/srv/my-app,/srv/another-app
PUBLIC_URL=https://mcp.example.com
MCP_POLICY_FILE=./policy.json

# Project health checks are restricted to explicitly registered destinations.
PROJECT_HEALTH_ALLOWED_HOSTS=app.example.com
```

For enterprise policy-as-code, copy [policy.example.json](policy.example.json) outside the repository or to a protected configuration path, set `MCP_POLICY_FILE`, and review changes through your normal configuration-management process. A policy can deny tools for a role or require an approval even when the key would otherwise allow the action.

Multi-host project execution is documented in [docs/SSH_NODES.md](docs/SSH_NODES.md). SSH remains disabled until a host, connection, project, identity, and applicable OAuth/organization/team policies are explicitly registered and enabled.

## Capability packs

The default experience is deliberately small: **Server Care** for operating a server and **Developer Work** for approved application work. An administrator can enable Advanced System Administration, Advanced Data Access, or Advanced Execution from **Administration → Capability packs**. Disabled packs are neither advertised to new MCP sessions nor executable if an AI client attempts a direct call.

Direct deployment is an Advanced Execution capability; the default is deployment planning only. Organization and team assignments remain part of the authorization model.

## 2.0 legacy-state migration

MCP Sentinel stores control-plane records in a mode-`0600` SQLite database using WAL, full synchronous transactions, migration versions, and a busy timeout. Do not place state or credentials in source control.

- The 1.x automation, fleet, backup-target, and webhook interfaces are removed in 2.0.
- Before starting the 2.0 API or broker against a database that contains those records, stop the 1.x services and run `MCP_LEGACY_EXPORT_OFFLINE=true MCP_LEGACY_EXPORT_DIR=/protected/export node scripts/export-legacy-state.js /protected/export/legacy.json` from the unpacked 2.0 bundle. Keep the same `MCP_LEGACY_EXPORT_DIR` set for the first 2.0 migration start.
- For JSON control-plane state, also set `MCP_LEGACY_JSON_FILE=/absolute/path/to/control-plane.json`; the exporter writes a protected sidecar verification marker that the dry-run and apply migration both authenticate.
- The export is redacted, hashed, written with mode `0600`, and recorded in SQLite. The 2.0 migration refuses to drop non-empty legacy tables when that verification marker is absent or does not match.
- **Deployments:** create a registered project with an allow-listed repository and service. `deploy_project` performs only `git pull --ff-only`, restarts that exact registered systemd service, then checks a health URL whose host is in `PROJECT_HEALTH_ALLOWED_HOSTS`. It requires `confirm: true`, an administrator identity, and key-level approval when approval mode is enabled.

For a nontechnical operator, start with Server Care, Guided Tasks, Approvals, Developer Work, and Connect AI. For AI clients, call `list_guided_workflows` first, use `plan_project_deployment` before deployment, and submit exact risky requests with `request_change_approval`.

## 🔑 Generate API Keys

```bash
# Generate admin key
node keygen.js admin admin

# Generate scoped user key
node keygen.js alice user run_project_tests,read_file,write_file
```

## 📊 Monitor

```bash
# Live audit log
tail -f logs/audit-$(date +%Y-%m-%d).log | jq

# View active sessions
curl -k https://localhost:4444/admin/sessions -H "X-API-Key: YOUR_KEY"

# Health check
curl -k https://localhost:4444/health
```

## Requirements

- Node.js 22+
- Linux (systemd-based)
- `openssl` (for HTTPS)
- Root or sudo for full admin tools

## Testing

```bash
npm test                 # unit and security tests
npm run test:ui          # Playwright browser flow (uses an isolated local Sentinel)
npm run test:live        # creates and removes one temporary no-login OS user; run only on a disposable or approved host
```

The live test verifies a low-privilege MCP identity can read system health but cannot read `/etc/shadow` or create users. Both integration suites use temporary state, keys, logs, and ports.

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
