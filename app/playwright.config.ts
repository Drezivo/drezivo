import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const PORT = 3000;
const isCI = Boolean(process.env["CI"]);
// Prefer local Brave when available. CI continues to use Playwright's Chromium.
const configuredBrave = process.env["DREZIVO_PLAYWRIGHT_BRAVE_PATH"];
const defaultBrave = process.platform === "win32" ? "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe" : undefined;
const bravePath = configuredBrave ?? (!isCI && defaultBrave && existsSync(defaultBrave) ? defaultBrave : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  ...(isCI ? { workers: 2 } : {}),
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: bravePath ? "brave" : "chromium", use: { ...devices["Desktop Chrome"], ...(bravePath ? { launchOptions: { executablePath: bravePath } } : {}) } },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
