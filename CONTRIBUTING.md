# Contributing to MCP Sentinel

First off, **thank you** for considering contributing! 🎉  
MCP Sentinel is open source and we welcome all contributions — bug fixes, new tools, security improvements, docs, and ideas.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Adding a New MCP Tool](#adding-a-new-mcp-tool)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Bugs](#reporting-bugs)
- [Security Vulnerabilities](#security-vulnerabilities)

---

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/). Be respectful, inclusive, and constructive.

---

## How to Contribute

### 🐛 Bug reports

Open an [issue](https://github.com/MarketingDotLimited/mcp-sentinel/issues) with the **Bug Report** template.

### 💡 Feature requests

Open an [issue](https://github.com/MarketingDotLimited/mcp-sentinel/issues) with the **Feature Request** template.

### 🔒 Security issues

**Do NOT open a public issue.** See [SECURITY.md](SECURITY.md).

### 📝 Code contributions

Fork → Branch → PR (see below).

---

## Development Setup

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/mcp-sentinel.git
cd mcp-sentinel

# 2. Install dependencies
npm install

# 3. Copy and configure environment
cp .env.example .env
# Edit .env — generate keys with:
node keygen.js

# 4. Run in dev mode (auto-restart on changes)
npm run dev

# 5. Test health endpoint
curl -k https://localhost:4444/health
```

---

## Project Structure

```
mcp-sentinel/
├── server.js          # Main server — Express + Streamable HTTP transport
├── security.js        # Auth middleware — API key, JWT, IP whitelist
├── audit.js           # Structured audit + error logging
├── keygen.js          # API key generator utility
├── setup.js           # First-time interactive setup wizard
└── tools/
    ├── system.js      # Shell commands, processes, system info
    ├── files.js       # File system CRUD with path sandboxing
    ├── services.js    # systemd services, journal logs, UFW firewall
    └── users.js       # User management, SSH keys
```

---

## Adding a New MCP Tool

1. **Choose the right file** in `tools/` (or create a new one for a new category)
2. **Export an async function** with `(args, identity)` signature
3. **Add role checks** — use `requireAdmin(identity)` if needed
4. **Register the tool** in `server.js` inside `createMcpServer()`:

```js
tool(
  'your_tool_name',
  'Description for the AI',
  {
    param: z.string().describe('What this param does'),
  },
  yourToolFunction
);
```

4. **Follow security practices:**
   - Validate all inputs
   - Restrict paths with `await resolveSafePath()`
   - Check role with `identity.role`
   - Never expose secrets in output

5. **Test it:**

```bash
# Get a JWT token
TOKEN=$(curl -k -s -X POST https://localhost:4444/auth/token \
  -H "X-API-Key: YOUR_KEY" | node -e "process.stdin.resume();process.stdin.on('data',d=>console.log(JSON.parse(d).token))")

# Connect via Streamable HTTP and call your tool
```

---

## Submitting a Pull Request

1. **Fork** the repo and create a branch: `git checkout -b feat/my-new-tool`
2. **Write clean, commented code** — match the existing style
3. **Test thoroughly** — including edge cases and error paths
4. **Update the README** if you added a tool or changed behavior
5. **Open a PR** with a clear title and description
6. **Reference any related issues**: `Closes #42`

### PR Checklist

- [ ] Code follows existing patterns
- [ ] No secrets or credentials in code
- [ ] New tools have role checks where appropriate
- [ ] Input validation added
- [ ] README updated if needed

---

## Reporting Bugs

Include in your bug report:

- **OS and Node.js version** (`uname -a`, `node -v`)
- **Steps to reproduce**
- **Expected vs actual behavior**
- **Relevant log output** from `./logs/`

---

## Security Vulnerabilities

Please read [SECURITY.md](SECURITY.md) — do not post security issues publicly.
