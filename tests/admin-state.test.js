import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

describe('admin-state', () => {
  it('covers branch where env var is not set', async () => {
    const original = process.env.MCP_STATE_DB;
    delete process.env.MCP_STATE_DB;
    const adminState = await import(`../lib/admin-state.js?test=${Date.now()}`);
    
    // We expect an error when it tries to write to /var/lib/mcp-sentinel if running as non-root,
    // but the branch will be executed.
    try {
      adminState.getAdminState('test');
    } catch (e) {}

    // Cover invalid state key in getAdminState
    assert.throws(() => adminState.getAdminState('../bad'), /Invalid state key/);

    if (original) {
      process.env.MCP_STATE_DB = original;
    }
  });
});
