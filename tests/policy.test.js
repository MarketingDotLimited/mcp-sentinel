import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

describe('policy.js full coverage', () => {
  let directory;
  let policyFile;

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-policy-full-'));
    policyFile = path.join(directory, 'policy.json');
    process.env.MCP_POLICY_FILE = policyFile;
  });

  after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    delete process.env.MCP_POLICY_FILE;
  });

  it('missing rules array throws', async () => {
    await fs.writeFile(policyFile, JSON.stringify({ notRules: [] }));
    const { evaluatePolicy } = await import(`../lib/policy.js?t=${Date.now()}`);
    await assert.rejects(evaluatePolicy({ tool: 't', identity: { role: 'r' } }), /Policy must contain rules/);
  });

  it('invalid JSON throws', async () => {
    await fs.writeFile(policyFile, 'invalid json');
    const { evaluatePolicy } = await import(`../lib/policy.js?t=${Date.now()}`);
    await assert.rejects(evaluatePolicy({ tool: 't', identity: { role: 'r' } }), /Policy configuration is invalid/);
  });

  it('cache invalidation when policy file mtime changes', async () => {
    await fs.writeFile(policyFile, JSON.stringify({ rules: [{ effect: 'deny', tools: ['a'] }] }));
    const { evaluatePolicy } = await import(`../lib/policy.js?t=${Date.now()}`);

    // Call 1: loads policy into cache
    const res1 = await evaluatePolicy({ tool: 'a', identity: { role: 'r' } });
    assert.equal(res1.allowed, false);

    // Call 2: file has NOT changed (mtime == cachedMtime), should return cached policy
    const res2 = await evaluatePolicy({ tool: 'a', identity: { role: 'r' } });
    assert.equal(res2.allowed, false);

    // Update file content AND mtime
    await new Promise(r => setTimeout(r, 50));
    await fs.writeFile(policyFile, JSON.stringify({ rules: [{ effect: 'require_approval', tools: ['a'] }] }));

    // Call 3: file HAS changed (mtime != cachedMtime), should reload new policy
    const res3 = await evaluatePolicy({ tool: 'a', identity: { role: 'r' } });
    assert.equal(res3.allowed, true);
    assert.equal(res3.requireApproval, true);
  });

  it('evaluatePolicy deny branch', async () => {
    await fs.writeFile(
      policyFile,
      JSON.stringify({
        rules: [{ effect: 'deny', tools: ['deny_tool'] }],
      })
    );
    const { evaluatePolicy } = await import(`../lib/policy.js?t=${Date.now()}`);
    const res = await evaluatePolicy({ tool: 'deny_tool', identity: { role: 'dev' } });
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'This action is denied by server policy');
  });

  it('simulatePolicy covers all branches', async () => {
    await fs.writeFile(
      policyFile,
      JSON.stringify({
        rules: [
          { effect: 'deny', tools: ['deny_tool'], roles: ['dev'] },
          { effect: 'require_approval', tools: ['approve_tool'] },
          { effect: 'require_approval', tools: ['*'], roles: ['admin'] }, // admin requires approval for everything else
        ],
      })
    );
    const { simulatePolicy } = await import(`../lib/policy.js?t=${Date.now()}`);

    // Validation
    await assert.rejects(simulatePolicy({ tool: 123, identity: {} }), /Invalid tool/);
    await assert.rejects(simulatePolicy({ tool: 'abc', identity: null }), /A role-bearing identity is required/);

    // Deny
    const res1 = await simulatePolicy({ tool: 'deny_tool', identity: { role: 'dev', userId: 'u' } });
    assert.equal(res1.allowed, false);
    assert.equal(res1.reason, 'This action is denied by server policy');

    // Require approval
    const res2 = await simulatePolicy({ tool: 'approve_tool', identity: { role: 'dev' } });
    assert.equal(res2.allowed, true);
    assert.equal(res2.requireApproval, true);
    assert.equal(res2.reason, 'This action requires administrator approval');

    // No matching deny or approval rule applies (for role 'dev' and tool 'other_tool', the 3rd rule is for 'admin' only, so no match)
    const res3 = await simulatePolicy({ tool: 'other_tool', identity: { role: 'dev' } });
    assert.equal(res3.allowed, true);
    assert.equal(res3.requireApproval, false);
    assert.equal(res3.reason, 'No matching deny or approval rule applies');
  });

  it('covers missing tool array via global JSON.parse mock', async () => {
    await fs.writeFile(policyFile, 'magic');
    const originalParse = JSON.parse;
    JSON.parse = function (text) {
      if (text === 'magic') {
        let callCount = 0;
        return {
          rules: [
            {
              effect: 'deny',
              get tools() {
                return callCount++ === 0 ? ['magic_tool'] : null;
              },
            },
          ],
        };
      }
      return originalParse(text);
    };

    try {
      const { evaluatePolicy } = await import(`../lib/policy.js?t=${Date.now()}`);
      // The first get is during loadPolicy validation.
      // The second get is during matches(rule, tool, identity).
      const res = await evaluatePolicy({ tool: 'magic_tool', identity: { role: 'dev' } });
      // Since it's null the second time, tools becomes [], so tools.includes('magic_tool') is false.
      // So it doesn't match the deny rule, allowing it.
      assert.equal(res.allowed, true);
    } finally {
      JSON.parse = originalParse;
    }
  });
});
