import '../test-env.js';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-policy-sim-'));
process.env.MCP_POLICY_FILE = path.join(directory, 'policy.json');
await fs.writeFile(
  process.env.MCP_POLICY_FILE,
  JSON.stringify({
    rules: [
      { effect: 'deny', tools: ['delete_user'], roles: ['developer'] },
      { effect: 'require_approval', tools: ['write_file'], roles: ['*'] },
    ],
  })
);
const { simulatePolicy } = await import(`../../lib/policy.js?sim=${Date.now()}`);
after(() => fs.rm(directory, { recursive: true, force: true }));

describe('policy simulator', () => {
  it('explains deny, approval, and allow decisions without exposing policy contents', async () => {
    const denied = await simulatePolicy({ tool: 'delete_user', identity: { userId: 'dev', role: 'developer' } });
    assert.equal(denied.allowed, false);
    const approval = await simulatePolicy({ tool: 'write_file', identity: { userId: 'dev', role: 'developer' } });
    assert.equal(approval.requireApproval, true);
    const allowed = await simulatePolicy({ tool: 'read_file', identity: { userId: 'dev', role: 'developer' } });
    assert.equal(allowed.allowed, true);
    assert.equal('fileContents' in denied, false);
  });
});
