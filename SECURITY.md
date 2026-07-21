# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.x (latest) | ✅ Yes |

---

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability in MCP Sentinel, please report it responsibly:

### How to Report

1. **GitHub Private Advisory** *(preferred)*:  
   Go to [Security → Report a vulnerability](https://github.com/MarketingDotLimited/mcp-sentinel/security/advisories/new)

2. **Email**:  
   Send details to the maintainers via the email listed on the [organization profile](https://github.com/MarketingDotLimited).

### What to Include

Please include as much of the following as possible:

- **Type of vulnerability** (e.g., command injection, auth bypass, path traversal)
- **Affected component** (e.g., `security.js`, `tools/system.js`)
- **Steps to reproduce**
- **Potential impact**
- **Suggested fix** (if you have one)

---

## Response Timeline

| Action | Timeline |
|---|---|
| Acknowledgement of report | Within **48 hours** |
| Initial assessment | Within **5 business days** |
| Patch released (critical) | Within **7 days** |
| Patch released (moderate) | Within **30 days** |
| Public disclosure | After patch is released |

We follow **responsible disclosure** — we will credit reporters in the release notes unless you prefer to remain anonymous.

---

## Security Design

MCP Sentinel is built with security as a primary concern:

- **API Key authentication** — 64-byte cryptographically random keys
- **JWT tokens** — IP-bound, short-lived (8h), signed with HS256
- **IP Whitelist** — per-key or global CIDR restrictions
- **Rate Limiting** — 60 req/min global, 10/15min for auth endpoints
- **Command Blacklist** — regex patterns blocking destructive commands
- **Path Sandboxing** — non-admin users locked to `/home/{username}`
- **Role-based access** — `admin` vs `user` with scope enforcement
- **Audit Logging** — every tool call logged with IP, user, result
- **Helmet.js** — security headers (CSP, HSTS, XSS protection)
- **TLS support** — HTTPS with TLS 1.2+ and strong cipher suites

---

## Known Limitations

- The server must run as `root` for full admin capabilities (user management, system services). If you only need file/command access, consider running as a non-root user.
- The command blacklist uses regex patterns and may not catch all edge cases. Always apply the principle of least privilege using scoped API keys.
- Self-signed certificates are provided for testing only. **Always use a trusted CA certificate in production.**
