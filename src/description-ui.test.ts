import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startWebServer } from "./server";
import { setWorktreeDescription } from "./worktrees";

const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, stdio: "ignore" });

let dir: string;
let browser: Browser;
let server: Awaited<ReturnType<typeof startWebServer>>;
const opened: string[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "worktree-ui-"));
  const app = join(dir, "app");
  git(dir, "init", "-q", "-b", "main", app);
  git(app, "commit", "-q", "--allow-empty", "-m", "init");
  git(app, "worktree", "add", "-q", "-b", "feat/x", join(dir, "app-x"));
  await setWorktreeDescription(app, join(dir, "app-x"), "Nota existente");
  server = await startWebServer(resolve(import.meta.dir, "..", "web"), { cwd: () => app, open: async (path: string) => void opened.push(path) });
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
});

afterAll(async () => {
  await browser?.close();
  rmSync(dir, { recursive: true, force: true });
});

for (const compact of [false, true]) {
  test(`doble clic sobre la descripción edita sin abrir el worktree (${compact ? "compacto" : "tarjeta"})`, async () => {
    const page = await browser.newPage();
    if (compact) await page.addInitScript(() => localStorage.setItem("compact", "true"));
    await page.goto(server.url);
    const item = page.locator("#list li", { hasText: "feat/x" });
    await item.waitFor();
    if (compact && !(await item.locator(".description-text").count())) await page.locator("#settings [name=compact]").check();
    opened.length = 0;
    await item.locator(".description-text p").dblclick();
    await item.locator("textarea").waitFor();
    expect(await page.evaluate<string | undefined>("document.activeElement?.tagName")).toBe("TEXTAREA");
    await page.waitForTimeout(200);
    expect(opened).toEqual([]);
    await page.keyboard.press("Escape");
    await item.locator(".description-text").waitFor();

    // Alt+Enter saves without leaving the field.
    await item.locator(".description-text p").dblclick();
    await item.locator("textarea").fill(`Nota ${compact}`);
    await page.keyboard.press("Alt+Enter");
    await item.locator(".description-text p", { hasText: `Nota ${compact}` }).waitFor();
    // Cmd/Ctrl+Enter (Mac / other platforms) also save.
    for (const key of ["Meta+Enter", "Control+Enter"]) {
      await item.locator(".description-text p").dblclick();
      await item.locator("textarea").fill(`Nota ${key}`);
      await page.keyboard.press(key);
      await item.locator(".description-text p", { hasText: `Nota ${key}` }).waitFor();
    }
    await page.close();
  });
}
