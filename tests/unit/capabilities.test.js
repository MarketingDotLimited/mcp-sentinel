import '../test-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { DatabaseSync } from 'node:sqlite';

describe('capabilities.js edge cases', () => {
  it('toolAvailability for deprecated tools and disabled packs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-caps-'));
    process.env.MCP_STATE_DB = path.join(dir, 'state.sqlite3');
    process.env.MCP_CAPABILITIES_FILE = path.join(dir, 'capabilities.json');

    const capabilities = await import(`../../lib/capabilities.js?test=${Date.now()}`);

    const resDisabled = await capabilities.toolAvailability('run_sandboxed_code');
    assert.equal(resDisabled.available, false);
    assert.equal(resDisabled.pack, 'advanced-execution');
    assert.ok(resDisabled.message.includes('capability pack is disabled'));

    await capabilities.setCapability('advanced-execution', true);

    const result = await capabilities.toolAvailability('deploy_project');
    assert.equal(result.available, true);
    assert.equal(result.deprecated, true);
    assert.ok(result.message.includes('Direct deployment is deprecated'));

    // Normal tool in pack, not deprecated
    await capabilities.setCapability('advanced-system-admin', true);
    const resNormal = await capabilities.toolAvailability('kill_process');
    assert.equal(resNormal.available, true);
    assert.equal(resNormal.deprecated, false);
    assert.equal(resNormal.message, undefined);

    const resUnknown = await capabilities.toolAvailability('unknown_tool');
    assert.equal(resUnknown.available, true);
    assert.equal(resUnknown.pack, null);

    assert.equal(capabilities.isDeprecatedTool('deploy_project'), true);
    assert.equal(capabilities.isDeprecatedTool('run_sandboxed_code'), false);
  });

  it('setCapability validations', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-caps-'));
    process.env.MCP_STATE_DB = path.join(dir, 'state.sqlite3');
    process.env.MCP_CAPABILITIES_FILE = path.join(dir, 'capabilities.json');
    const capabilities = await import(`../../lib/capabilities.js?test=${Date.now()}`);

    await assert.rejects(capabilities.setCapability('unknown', true), /Unknown capability pack/);
    await assert.rejects(capabilities.setCapability('advanced-execution', 'yes'), /enabled must be true or false/);
    await assert.rejects(
      capabilities.setCapability('core-server-care', false),
      /Core capability packs must remain enabled/
    );
  });

  it('rolls back on database error in save', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-caps-'));
    process.env.MCP_STATE_DB = path.join(dir, 'state.sqlite3');
    process.env.MCP_CAPABILITIES_FILE = path.join(dir, 'capabilities.json');

    const capabilities = await import(`../../lib/capabilities.js?test=${Date.now()}`);

    await capabilities.getCapabilities();

    const db = new DatabaseSync(process.env.MCP_STATE_DB);
    db.exec(
      'CREATE TRIGGER fail_insert BEFORE INSERT ON capabilities BEGIN SELECT RAISE(ABORT, "aborting insert"); END;'
    );
    db.close();

    await assert.rejects(capabilities.setCapability('advanced-execution', true), /aborting insert/);
  });

  it('handles USE_LEGACY_JSON = true', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-caps-legacy-'));
    delete process.env.MCP_STATE_DB;
    process.env.MCP_CAPABILITIES_FILE = path.join(dir, 'capabilities.json');

    const capabilities = await import(`../../lib/capabilities.js?test=${Date.now()}`);

    const caps = await capabilities.getCapabilities();
    assert.equal(caps.find(c => c.id === 'advanced-execution').enabled, false);

    await capabilities.setCapability('advanced-execution', true);

    const json = JSON.parse(await fs.readFile(process.env.MCP_CAPABILITIES_FILE, 'utf8'));
    assert.equal(json.enabled['advanced-execution'], true);

    const capabilities2 = await import(`../../lib/capabilities.js?test=${Date.now()}`);
    const caps2 = await capabilities2.getCapabilities();
    assert.equal(caps2.find(c => c.id === 'advanced-execution').enabled, true);
  });

  it('handles USE_LEGACY_JSON = true with null file content', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-caps-legacy-null-'));
    delete process.env.MCP_STATE_DB;
    process.env.MCP_CAPABILITIES_FILE = path.join(dir, 'capabilities.json');
    await fs.writeFile(process.env.MCP_CAPABILITIES_FILE, 'null');
    const capabilities = await import(`../../lib/capabilities.js?test=${Date.now()}`);
    const caps = await capabilities.getCapabilities();
    assert.equal(caps.find(c => c.id === 'advanced-execution').enabled, false);
  });

  it('throws on non-ENOENT error in legacy load', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-caps-legacy-'));
    delete process.env.MCP_STATE_DB;
    process.env.MCP_CAPABILITIES_FILE = path.join(dir, 'capabilities.json');

    mock.method(fs, 'readFile', () => {
      throw new Error('mock legacy error');
    });

    const capabilities = await import(`../../lib/capabilities.js?test=${Date.now()}`);
    await assert.rejects(capabilities.getCapabilities(), /mock legacy error/);

    mock.restoreAll();
  });

  it('migrates from existing capabilities.json with unknown pack and null content', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-caps-migrate-'));
    process.env.MCP_STATE_DB = path.join(dir, 'state.sqlite3');
    process.env.MCP_CAPABILITIES_FILE = path.join(dir, 'capabilities.json');

    await fs.writeFile(process.env.MCP_CAPABILITIES_FILE, 'null');

    const capabilities = await import(`../../lib/capabilities.js?test=${Date.now()}`);
    const caps = await capabilities.getCapabilities();
    assert.equal(caps.find(c => c.id === 'advanced-execution').enabled, false);

    // Check backup was created
    await fs.access(`${process.env.MCP_CAPABILITIES_FILE}.pre-sqlite-backup`);
  });

  it('migrates from existing capabilities.json with unknown pack and false enabled in object', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-caps-migrate-unknown-'));
    process.env.MCP_STATE_DB = path.join(dir, 'state.sqlite3');
    process.env.MCP_CAPABILITIES_FILE = path.join(dir, 'capabilities.json');

    // Include false for a pack to hit the enabled === true ? 1 : 0 ternary else branch
    await fs.writeFile(
      process.env.MCP_CAPABILITIES_FILE,
      JSON.stringify({
        enabled: { 'unknown-pack-999': true, 'advanced-execution': true, 'advanced-system-admin': false },
      })
    );

    const capabilities = await import(`../../lib/capabilities.js?test=${Date.now()}`);
    const caps = await capabilities.getCapabilities();
    assert.equal(caps.find(c => c.id === 'advanced-execution').enabled, true);
    assert.equal(caps.find(c => c.id === 'advanced-system-admin').enabled, false);
  });

  it('throws on non-ENOENT error during migration fs.readFile', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-caps-migrate-'));
    process.env.MCP_STATE_DB = path.join(dir, 'state.sqlite3');
    process.env.MCP_CAPABILITIES_FILE = path.join(dir, 'capabilities.json');

    mock.method(fs, 'readFile', async () => {
      const e = new Error('mock migration error');
      e.code = 'EACCES';
      throw e;
    });

    const capabilities = await import(`../../lib/capabilities.js?test=${Date.now()}`);
    await assert.rejects(capabilities.getCapabilities(), /mock migration error/);

    mock.restoreAll();
  });

  it('covers environment variable defaults', async () => {
    delete process.env.MCP_CAPABILITIES_FILE;
    delete process.env.MCP_STATE_DB;

    mock.method(fs, 'mkdir', () => {
      throw new Error('mock mkdir error');
    });

    const capabilities = await import(`../../lib/capabilities.js?test=${Date.now()}`);
    await assert.rejects(capabilities.getCapabilities(), /mock mkdir error/);

    mock.restoreAll();
  });
});
