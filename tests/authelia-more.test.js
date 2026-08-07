import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import * as yaml from 'js-yaml';

describe('authelia extra branches', async () => {
  let tmpDir;
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-auth-extra-'));
    process.env.AUTHELIA_USERS_FILE = path.join(tmpDir, 'users.yml');
    process.env.MCP_USERS_FILE = path.join(tmpDir, 'mcp-users.json');
    // Initialize required files
    await fs.writeFile(process.env.AUTHELIA_USERS_FILE, 'null');
    await fs.writeFile(process.env.MCP_USERS_FILE, '{}');
  });
  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('covers branches', async () => {
    const authelia = await import(`../lib/authelia.js?test=${Date.now()}`);
    // 346: add user with empty users file
    await authelia.addOAuthUser({ username: 'u1', password: 'p1', email: 'u1@x.com' });
    
    // 373: update user with empty users file
    await fs.writeFile(process.env.AUTHELIA_USERS_FILE, 'null');
    await assert.rejects(authelia.updateOAuthUser('u1', { email: 'u2@x.com' }), /User 'u1' not found/);
    
    // 438: delete user with empty users file
    await assert.rejects(authelia.deleteOAuthUser('u1'), /User 'u1' not found/);

    // 394: updatesAuthorization without existing mapping
    await authelia.addOAuthUser({ username: 'u2', password: 'p1', email: 'u2@x.com' });
    // corrupt mapping
    await fs.writeFile(process.env.MCP_USERS_FILE, '{}');
    await authelia.updateOAuthUser('u2', { role: 'admin' });
  });
});
