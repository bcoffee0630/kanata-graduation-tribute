const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5050',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
    { name: 'webkit-desktop', testMatch: /(?:gallery|toast)\.spec\.js$/, use: { browserName: 'webkit', viewport: { width: 1440, height: 900 } } },
    { name: 'webkit-mobile', testMatch: /(?:gallery|toast)\.spec\.js$/, use: { browserName: 'webkit', viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } }
  ]
});
