/**
 * Regenerates the extension icon (media/icon.png) from media/worktree.svg.
 *
 * vsce only accepts a PNG for the `icon` field, so the activity bar glyph is drawn in white on a
 * solid rounded square (readable on light and dark themes) and rendered with Playwright (Chromium).
 *
 *   bun run icon
 *
 * Set PLAYWRIGHT_CHROMIUM_PATH to use a Chromium binary other than Playwright's own.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const size = 512;
const root = resolve(import.meta.dir, "..");
const svg = readFileSync(resolve(root, "media/worktree.svg"), "utf8")
  .replace(/currentColor/g, "#ffffff")
  .replace(/width="24" height="24"/, 'width="100%" height="100%"');

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}
    div{box-sizing:border-box;width:${size}px;height:${size}px;padding:112px;border-radius:96px;background:#1f2937}
    svg{display:block}</style><div>${svg}</div>`,
  );
  await page.screenshot({ path: resolve(root, "media/icon.png"), omitBackground: true });
} finally {
  await browser.close();
}
