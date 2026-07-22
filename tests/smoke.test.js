import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFile } from '../tools/files.js';
import { getProcesses } from '../tools/system.js';

describe('MCP Sentinel Security Sandbox Tests', () => {
  
  it('Should reject reading /etc/shadow for non-admin', async () => {
    try {
      await readFile({ filePath: '/etc/shadow' }, { userId: 'testuser', role: 'user' });
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert.match(err.message, /forbidden|not permitted/);
    }
  });

  it('Should reject reading /etc/shadow via path traversal', async () => {
    try {
      await readFile({ filePath: '/tmp/../../etc/shadow' }, { userId: 'testuser', role: 'user' });
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert.match(err.message, /forbidden|not permitted/);
    }
  });

  it('Should successfully run getProcesses without shell escape', async () => {
    const result = await getProcesses({ filter: 'bash' }, { userId: 'root', role: 'user' });
    assert.ok(typeof result.processes === 'string');
  });

});
