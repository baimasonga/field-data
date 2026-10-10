import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

// Browser regression tests use API fixtures and require no backend or credentials.
const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
export default defineConfig({
  testDir: './tests',
  testMatch: ['field-data-fieldwork.spec.js', 'field-data-dashboard.spec.js', 'field-data-review.spec.js', 'field-data-features.spec.js', 'field-data-location.spec.js', 'field-data-contradictions.spec.js', 'field-data-identity-keys.spec.js', 'field-data-survey-doctor.spec.js', 'field-data-imagery.spec.js', 'field-data-backcheck-sample.spec.js', 'field-data-survey-simulation.spec.js'],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}
  },
  webServer: process.env.ODK_URL ? undefined : {
    command: 'npm exec -- vite --host 127.0.0.1 --port 8989',
    cwd: resolve(import.meta.dirname, '..'),
    url: appUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});
