import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'mcp-sentinel',
    version:
      process.env.npm_package_version ||
      JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version,
  });
});

router.get('/.well-known/oauth-protected-resource', (req, res) => {
  const host = process.env.OAUTH_EXTERNAL_URL || `https://${req.get('host') || 'begin.shopping:2053'}`;
  res.json({
    resource: host,
    authorization_servers: [process.env.AUTHELIA_ISSUER || 'https://begin.shopping:2083'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    bearer_methods_supported: ['header'],
  });
});

export default router;
