#!/usr/bin/env node
// ============================================================
//  keygen.js - Generate secure API keys
// ============================================================
import { randomBytes } from 'crypto';

const [,, userId = 'user', role = 'user', scopes = ''] = process.argv;

const key = `mcp_${randomBytes(32).toString('hex')}`;

console.log(`
╔═════════════════════════════════════════════════════════════════╗
║                    Generated API Key                            ║
╠═════════════════════════════════════════════════════════════════╣
║  Key    : ${key.slice(0, 52)}  ║
║           ${key.slice(52).padEnd(52)}  ║
║  User   : ${userId.padEnd(52)}  ║
║  Role   : ${role.padEnd(52)}  ║
║  Scopes : ${(scopes || '*').padEnd(52)}  ║
╚═════════════════════════════════════════════════════════════════╝

Add to your .env:
  ADMIN_API_KEY=${key}

Or add via API (admin only):
  POST /admin/keys
  {
    "key": "${key}",
    "userId": "${userId}",
    "role": "${role}",
    "allowedIPs": [],
    "scopes": [${scopes ? scopes.split(',').map(s => `"${s.trim()}"`).join(', ') : '"*"'}],
    "label": "Generated key"
  }
`);
