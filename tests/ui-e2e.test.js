// Opt-in browser test for the nontechnical dashboard paths.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { chromium } from '@playwright/test';

const enabled = process.env.RUN_UI_E2E === 'true';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sentinel-ui-'));
const key = 'mcp_abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz1234';
let child;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the UI server');
}

after(async () => {
  if (child && !child.killed) child.kill('SIGTERM');
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('dashboard UX', { skip: !enabled }, () => {
  it('keeps the nontechnical experience focused while exposing capability packs to administrators', async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        HOST: '127.0.0.1',
        USE_HTTPS: 'false',
        ALLOWED_ORIGINS: baseUrl,
        ADMIN_API_KEY: key,
        JWT_SECRET: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef',
        KEYS_FILE: path.join(tmp, 'keys.json'),
        KEYSTORE_FILE: path.join(tmp, 'keys.json'),
        CONTROL_PLANE_STATE_FILE: path.join(tmp, 'state.json'),
        MCP_CAPABILITIES_FILE: path.join(tmp, 'capabilities.json'),
        AUDIT_LOG_DIR: path.join(tmp, 'logs'),
      },
      stdio: 'ignore',
    });
    await waitFor(`${baseUrl}/health`);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.locator('input[type="password"]').fill(key);
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Server Care'));

      await page.locator('a[href="#/workflows"]').click();
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Guided'));
      assert.match(await page.locator('body').innerText(), /Check why my server or website is slow/);
      assert.equal(await page.locator('a[href="#/automations"]').isVisible(), false);

      await page.locator('a[href="#/administration"]').click();
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Administration'));
      assert.match(await page.locator('body').innerText(), /Capability packs/);
      assert.match(await page.locator('body').innerText(), /Advanced Data Access[\s\S]*Disabled by default/);

      await page.getByRole('link', { name: /ChatGPT action manifest/ }).click();
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('ChatGPT action manifest'));
      await page.waitForFunction(() => document.querySelector('#manifest-status')?.textContent?.includes('Manifest v'));
      const manifestText = await page.locator('body').innerText();
      assert.match(manifestText, /Run Project Tests/);
      assert.match(manifestText, /Refresh the connector action snapshot/);

      await page.locator('a[href="#/connect"]').click();
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Connect your AI'));
      const connectText = await page.locator('body').innerText();
      for (const platform of [
        'ChatGPT (web)',
        'Claude (web)',
        'Claude Desktop',
        'Claude Code CLI',
        'Codex CLI',
        'Antigravity CLI / IDE',
        'Any other MCP-capable tool',
      ]) {
        assert.match(connectText, new RegExp(platform.replace(/[()]/g, '\\$&')));
      }
      assert.match(connectText, /What this does — and why it is safer/);
      assert.match(connectText, /Cloud connector readiness/);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
});
