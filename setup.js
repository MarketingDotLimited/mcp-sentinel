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
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

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
  const port = await ask('Port [4444]: ') || '4444';
  const useHttps = (await ask('Use HTTPS? (recommended) [Y/n]: ')).toLowerCase() !== 'n';
  const allowedIPs = await ask('Allowed IPs (comma-separated, empty = all): ');
  const allowedOrigins = await ask('Allowed CORS origins (comma-separated, empty = all): ');

  // 3. Generate self-signed cert if HTTPS
  if (useHttps) {
    console.log('\n📜 Generating self-signed TLS certificate...');
    try {
      await fs.mkdir(path.join(__dirname, 'certs'), { recursive: true });
      await execFileAsync('openssl', [
        'req', '-x509', '-nodes', '-days', '365',
        '-newkey', 'rsa:4096',
        '-keyout', path.join(__dirname, 'certs', 'server.key'),
        '-out', path.join(__dirname, 'certs', 'server.crt'),
        '-subj', '/CN=mcp-server/O=MCP/C=US',
        '-addext', 'subjectAltName=IP:0.0.0.0,IP:127.0.0.1',
      ]);
      console.log('✅ Certificate generated: ./certs/server.crt');
      console.log('   For production, replace with a Let\'s Encrypt certificate!');
    } catch (err) {
      console.error('⚠️  openssl not found. Install openssl or set USE_HTTPS=false');
      process.exit(1);
    }
  }

  // 4. Write .env
  const envContent = `# MCP Server Control - Auto-generated configuration
# Generated: ${new Date().toISOString()}

PORT=${port}
HOST=0.0.0.0
NODE_ENV=production

TLS_CERT_PATH=./certs/server.crt
TLS_KEY_PATH=./certs/server.key
USE_HTTPS=${useHttps}

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
SUDO_ALLOWED_USERS=root
`;

  await fs.writeFile(path.join(__dirname, '.env'), envContent, { mode: 0o600 });
  console.log('\n✅ .env file created (permissions: 600)');

  // 5. Create logs directory
  await fs.mkdir(path.join(__dirname, 'logs'), { recursive: true });
  console.log('✅ ./logs directory created');

  // 6. Create systemd service file
  const serviceFile = `[Unit]
Description=MCP Server Control
After=network.target
Wants=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${__dirname}
ExecStart=/usr/bin/node ${path.join(__dirname, 'server.js')}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mcp-server

# Security hardening
NoNewPrivileges=false
PrivateTmp=false
ProtectSystem=false

[Install]
WantedBy=multi-user.target
`;

  await fs.writeFile(path.join(__dirname, 'mcp-server.service'), serviceFile);
  console.log('✅ systemd service file created: ./mcp-server.service');

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
║  ${`${protocol}://YOUR_SERVER_IP:${port}`.padEnd(50)}  ║
║                                                      ║
║  MCP Endpoint (for AI clients):                      ║
║  ${`${protocol}://YOUR_SERVER_IP:${port}/mcp`.padEnd(50)}  ║
╠══════════════════════════════════════════════════════╣
║  Next Steps:                                         ║
║  1. npm start                    (run server)        ║
║  2. Install systemd service:                         ║
║     cp mcp-server.service /etc/systemd/system/       ║
║     systemctl enable --now mcp-server                ║
╚══════════════════════════════════════════════════════╝
`);

  rl.close();
}

main().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
