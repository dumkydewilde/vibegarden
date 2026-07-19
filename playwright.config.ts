import { defineConfig, devices } from "@playwright/test";

const port = 8788;

export default defineConfig({
  testDir: "./test/security",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://vibegarden.test:${port}`,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      launchOptions: {
        args: [
          `--host-resolver-rules=MAP vibegarden.test 127.0.0.1,MAP usercontent.vibegarden.test 127.0.0.1`,
        ],
      },
    },
  }],
  webServer: {
    command: `npx wrangler dev --config wrangler.security.jsonc --port ${port} --ip 127.0.0.1`,
    url: `http://127.0.0.1:${port}/__fixture/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
