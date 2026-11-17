import { defineConfig, devices } from '@playwright/test';

const DEV_URL = 'http://localhost:4200';
const PRODUCTION_PORT = 4300;
const PRODUCTION_URL = `http://localhost:${PRODUCTION_PORT}`;
const PRODUCTION_SPEC = /production-csp\.spec\.ts$/;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'dev',
      testIgnore: PRODUCTION_SPEC,
      use: { ...devices['Desktop Chrome'], baseURL: DEV_URL },
    },
    {
      name: 'production',
      testMatch: PRODUCTION_SPEC,
      use: { ...devices['Desktop Chrome'], baseURL: PRODUCTION_URL },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: DEV_URL,
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // npm run e2e builds the client first; building here would run alongside ng serve and can exhaust a container's memory.
      command: 'npm run start -w @slm/server',
      url: PRODUCTION_URL,
      // Blank, not inherited: the dev container sets an allow-list for :4200, and production must use its same-origin check.
      env: { PORT: String(PRODUCTION_PORT), ALLOWED_ORIGINS: '' },
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
