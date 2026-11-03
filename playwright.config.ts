import { defineConfig } from "@playwright/test";

// Specs end in `.pw.ts` so `bun test` (which also matches `.spec.ts`) never picks them up.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.pw.ts",
  use: { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined } },
});
