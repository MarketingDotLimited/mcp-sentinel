import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: /.*\.spec\.js/,
  timeout: 30 * 1000,
  expect: {
    timeout: 5000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html'],
    ['list']
  ],
  use: {
    actionTimeout: 0,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: 'node server.js',
    port: 25229,
    env: {
      NODE_ENV: 'test',
      PORT: '25229',
      HOST: '127.0.0.1',
      USE_HTTPS: 'false',
      ALLOWED_ORIGINS: 'http://127.0.0.1:25229,http://localhost:25229',
      ADMIN_API_KEY: 'mcp_abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz1234',
      JWT_SECRET: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef',
      MCP_STATE_DB: '/tmp/playwright-mcp-state.sqlite3',
      KEYS_FILE: '/tmp/playwright-mcp-keys.json',
      KEYSTORE_FILE: '/tmp/playwright-mcp-keys.json',
      CONTROL_PLANE_STATE_FILE: '/tmp/playwright-mcp-state.json',
      MCP_CAPABILITIES_FILE: '/tmp/playwright-mcp-capabilities.json',
      AUDIT_LOG_DIR: '/tmp/playwright-mcp-logs',
    },
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
