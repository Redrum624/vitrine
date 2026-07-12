/**
 * Playwright Configuration for Vitrine E2E Tests
 *
 * Configured to test the Electron application with Chromium.
 * Uses the built application for testing.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Electron tests should run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for Electron
  reporter: 'html',

  use: {
    // Base URL for the dev server
    baseURL: 'http://localhost:3005',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video recording
    video: 'on-first-retry',

    // Timeout for actions
    actionTimeout: 10000,
  },

  // Configure projects for different testing scenarios
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run local dev server before starting the tests
  webServer: {
    command: 'npm run dev-server-only',
    url: 'http://localhost:3005',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },

  // Global timeout for each test
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000,
  },
});
