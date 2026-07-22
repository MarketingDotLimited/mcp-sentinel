#!/usr/bin/env node
// ============================================================
//  setup.js - First-time setup wizard
// ============================================================
import { randomBytes } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║        MCP Server Control - First-Time Setup         ║
╚══════════════════════════════════════════════════════╝
`);

  // 1. Generate secrets
  const jwtSecret = randomBytes(64).toString('hex');
  const adminKey = `mcp_${randomBytes(32).toString('hex')}`;

  // 2. Ask configuration
  let portStr = (await ask('Port [4444]: ')) || '4444';
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error('Invalid port. Must be an integer between 1 and 65535.');
    process.exit(1);
  }
  const useHttps = (await ask('Use HTTPS? (recommended) [Y/n]: ')).toLowerCase() !== 'n';
  const allowedIPs = await ask('Allowed IPs (comma-separated, empty = all): ');
  if (!/^[0-9a-fA-F:\.,\s/]*$/.test(allowedIPs)) {
    console.error('Invalid characters in Allowed IPs');
    process.exit(1);
  }
  const allowedOrigins = await ask('Allowed CORS origins (comma-separated, empty = all): ');
  if (/[<>"'\n\r]/.test(allowedOrigins)) {
    console.error('Invalid characters in Allowed Origins');
    process.exit(1);
  }
  const serverIp = (await ask('Server IP or Hostname [127.0.0.1]: ')) || '127.0.0.1';

  let acmeDomain = '';
  let acmeEmail = '';
  let acmePort = '80';
  if (useHttps) {
    const useAcme =
      (
        await ask(
          "Configure Let's Encrypt auto-TLS? (requires domain pointing to this server and port 80 open) [y/N]: "
        )
      ).toLowerCase() === 'y';
    if (useAcme) {
      acmeDomain = await ask('  Domain name (e.g. mcp.example.com): ');
      acmeEmail = await ask('  Email address (for expiry notices): ');
      acmePort =
        (await ask(
          '  Challenge server port (must be accessible externally on port 80 via port-forwarding or directly) [80]: '
        )) || '80';
    }
  }

  // 3. Generate self-signed cert if HTTPS
  if (useHttps && !acmeDomain) {
    console.log('\n📜 Generating self-signed TLS certificate...');
    try {
      await fs.mkdir(path.join(__dirname, 'certs'), { recursive: true });
      await execFileAsync('openssl', [
        'req',
        '-x509',
        '-nodes',
        '-days',
        '365',
        '-newkey',
        'rsa:4096',
        '-keyout',
        path.join(__dirname, 'certs', 'server.key'),
        '-out',
        path.join(__dirname, 'certs', 'server.crt'),
        '-subj',
        '/CN=mcp-server/O=MCP/C=US',
        '-addext',
        `subjectAltName=IP:${serverIp},DNS:${serverIp},IP:127.0.0.1,DNS:localhost`,
      ]);
      console.log('✅ Certificate generated: ./certs/server.crt');
      console.log("   For production, replace with a Let's Encrypt certificate!");
    } catch (err) {
      console.error('⚠️  openssl not found. Install openssl or set USE_HTTPS=false');
      process.exit(1);
    }
  } else if (useHttps && acmeDomain) {
    console.log("\n📜 Let's Encrypt auto-TLS will provision certificates on first run.");
  }

  // 4. Check if .env exists
  try {
    await fs.access(path.join(__dirname, '.env'));
    const overwrite =
      (await ask('\n⚠️  .env already exists. Overwrite and generate new secrets? [y/N]: ')).toLowerCase() === 'y';
    if (!overwrite) {
      console.log('Setup aborted. Existing .env preserved.');
      process.exit(0);
    }
  } catch (err) {
    /* .env doesn't exist, proceed */
  }

  // 5. Write .env
  const envContent = `# MCP Server Control - Auto-generated configuration
# Generated: ${new Date().toISOString()}

PORT=${port}
HOST=0.0.0.0
NODE_ENV=production

TLS_CERT_PATH=./certs/server.crt
TLS_KEY_PATH=./certs/server.key
USE_HTTPS=${useHttps}

ACME_DOMAIN=${acmeDomain}
ACME_EMAIL=${acmeEmail}
ACME_CHALLENGE_PORT=${acmePort}

JWT_SECRET=${jwtSecret}
JWT_EXPIRY=8h

ADMIN_API_KEY=${adminKey}

ALLOWED_IPS=${allowedIPs}
ALLOWED_ORIGINS=${allowedOrigins}

RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60

AUDIT_LOG_DIR=./logs
AUDIT_LOG_KEEP_DAYS=30

MAX_OUTPUT_SIZE=1048576

# Optional OAuth/OIDC bearer-token support for cloud MCP connectors.
# Set these to your public Authelia issuer and JWKS endpoint before enabling
# a ChatGPT or other cloud OAuth connector.
PUBLIC_URL=
OAUTH_RESOURCE_URL=
AUTHELIA_ISSUER=
AUTHELIA_JWKS_URL=
`;

  await fs.writeFile(path.join(__dirname, '.env'), envContent, { mode: 0o600 });
  console.log('\n✅ .env file created (permissions: 600)');

  // 6. Create logs directory
  await fs.mkdir(path.join(__dirname, 'logs'), { recursive: true });
  console.log('✅ ./logs directory created');

  // Production units are checked-in under deploy/. The setup wizard never
  // generates a root-running service from the current checkout.
  console.log('✅ Hardened production service templates are available under deploy/');

  // 7. Print summary
  const protocol = useHttps ? 'https' : 'http';
  console.log(`
╔══════════════════════════════════════════════════════╗
║                  Setup Complete! 🎉                  ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  ADMIN API KEY (save this securely!):                ║
║  ${adminKey.slice(0, 50)}  ║
║  ${adminKey.slice(50).padEnd(50)}  ║
║                                                      ║
║  Server URL:                                         ║
║  ${`${protocol}://${serverIp}:${port}`.padEnd(50)}  ║
║                                                      ║
║  MCP Endpoint (for AI clients):                      ║
║  ${`${protocol}://${serverIp}:${port}/mcp`.padEnd(50)}  ║
╠══════════════════════════════════════════════════════╣
║  Next Steps:                                         ║
║  1. npm start                    (run server)        ║
║  2. For production, follow docs/REMEDIATION.md       ║
║     and install both hardened systemd services.      ║
╚══════════════════════════════════════════════════════╝
`);

  rl.close();
}

main().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
