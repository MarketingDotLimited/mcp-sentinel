import '../test-env.js';
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('security.js legacy state', async () => {
  let tmpDir;
  let security;
  let revFile;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-security-leg-'));
    revFile = path.join(tmpDir, 'rev.json');
    fs.writeFileSync(
      revFile,
      JSON.stringify({
        revocations: [
          { jti: 'test-jti', expiresAt: Date.now() + 10000 },
          { jti: 'expired', expiresAt: Date.now() - 10000 },
        ],
      })
    );

    // Write invalid file to test error path
    const revFile2 = path.join(tmpDir, 'rev2.json');
    fs.writeFileSync(revFile2, '{ bad_json }');

    process.env.JWT_REVOCATION_FILE = revFile;
    delete process.env.MCP_STATE_DB;
    process.env.KEYSTORE_FILE = path.join(tmpDir, 'keys.json');
    process.env.JWT_SECRET = 's'.repeat(64);

    security = await import(`../../security.js?test=${Date.now()}`);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles legacy revocations', () => {
    const res = { json: b => b };
    security.revokeSessionToken(
      { identity: { authType: 'apiKey', jti: 'new-jti', tokenExpiresAt: Date.now() + 10000 }, clientIP: '1.2.3.4' },
      res
    );

    const saved = JSON.parse(fs.readFileSync(revFile, 'utf8'));
    assert.ok(saved.revocations.find(r => r.jti === 'new-jti'));
    assert.ok(saved.revocations.find(r => r.jti === 'test-jti'));
    assert.ok(!saved.revocations.find(r => r.jti === 'expired'));
  });

  it('handles invalid legacy file parsing gracefully', async () => {
    process.env.JWT_REVOCATION_FILE = path.join(tmpDir, 'rev2.json');
    try {
      await import(`../../security.js?test=err_${Date.now()}`);
      assert.fail('Should have thrown on bad JSON');
    } catch (err) {
      assert.match(err.message, /Invalid JWT revocation state/);
    }
  });
});
