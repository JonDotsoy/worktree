/**
 * Regenerates the README screenshots in docs/screenshots.
 *
 * Builds a throwaway git repo with a few worktrees, serves the real `web/` UI with the
 * extension's own server and captures it with Playwright (Chromium).
 *
 *   bun run screenshots
 *
 * Set PLAYWRIGHT_CHROMIUM_PATH to use a Chromium binary other than Playwright's own.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

// The UI shortens paths under the home directory to `~`, and Node reads the home directory
// at startup, so run again as a child process with a throwaway $HOME.
if (!process.env.SHOTS_HOME) {
  const home = mkdtempSync(join(tmpdir(), "worktree-shots-"));
  try {
    const { status } = spawnSync(process.execPath, [import.meta.path], { stdio: "inherit", env: { ...process.env, HOME: home, SHOTS_HOME: home } });
    process.exitCode = status ?? 1;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  process.exit();
}
const home = process.env.SHOTS_HOME;
const { startWebServer } = await import("../src/server");
const { setBaseBranch } = await import("../src/worktrees");

const root = resolve(import.meta.dir, "..");
const outDir = join(root, "docs", "screenshots");
mkdirSync(outDir, { recursive: true });

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Demo", GIT_AUTHOR_EMAIL: "demo@example.com", GIT_COMMITTER_NAME: "Demo", GIT_COMMITTER_EMAIL: "demo@example.com" };

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, env: gitEnv, stdio: "ignore" });
}

/** Commits in `cwd` with the given age so the relative dates in the UI are stable. */
function commit(cwd: string, message: string, secondsAgo: number): void {
  const date = `${Math.floor(Date.now() / 1000) - secondsAgo} +0000`;
  execFileSync("git", ["commit", "--allow-empty", "-m", message], {
    cwd,
    env: { ...gitEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    stdio: "ignore",
  });
}

const projects = join(home, "proyectos");
const app = join(projects, "app");
mkdirSync(app, { recursive: true });
git(app, "init", "-q", "-b", "main");
commit(app, "chore: initial commit", 5 * 86400);
git(app, "worktree", "add", "-q", "-b", "feat/login", join(projects, "app-login"));
commit(join(projects, "app-login"), "feat: login form", 2 * 3600);
git(app, "worktree", "add", "-q", "-b", "fix/bug", join(projects, "app-fix"));
commit(join(projects, "app-fix"), "fix: handle empty list", 6 * 60);
git(app, "worktree", "add", "-q", "--detach", join(projects, "app-hotfix"), "main");
git(app, "worktree", "lock", join(projects, "app-hotfix"));
await setBaseBranch(app, "main");
// The folder where the extension creates new worktrees is `.worktree/` by default.
writeFileSync(join(app, ".gitignore"), ".worktree/\n");

const current = join(projects, "app-fix");
const server = await startWebServer(join(root, "web"), { cwd: () => current, open: async () => {} });

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 380, height: 520 }, deviceScaleFactor: 2, permissions: ["clipboard-read", "clipboard-write"] });

async function open(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(server.url);
  await page.locator("#list li").first().waitFor();
  return page;
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(outDir, `${name}.png`) });

try {
  let page = await open();
  await shot(page, "current");

  await page.locator("#list li", { hasText: "feat/login" }).click({ button: "right", position: { x: 120, y: 30 } });
  await page.locator("#menu:not([hidden])").waitFor();
  await shot(page, "menu-abrir");
  await page.close();

  page = await open();
  await page.locator("#list li", { hasText: "feat/login" }).locator(".copy").click();
  await page.locator("#list li .copy", { hasText: "✅" }).waitFor();
  await shot(page, "copiar-ruta");
  await page.close();

  page = await open();
  await page.click("#settings-toggle");
  await page.locator("#settings:not([hidden])").waitFor();
  await page.fill("[name=worktreesDir]", ".trees");
  await page.locator("[name=worktreesDir]").dispatchEvent("change");
  await page.locator("#settings-message", { hasText: "Guardado" }).waitFor();
  await shot(page, "configuracion");
  await page.fill("[name=worktreesDir]", ".worktree");
  await page.locator("[name=worktreesDir]").dispatchEvent("change");
  await page.close();

  page = await open();
  await page.click("#create");
  await page.fill("[name=branch]", "feat/dashboard");
  await shot(page, "crear-worktree-formulario");
  await page.click("#create-form button[type=submit]");
  await page.locator("#list li", { hasText: "feat/dashboard" }).waitFor();
  await shot(page, "crear-worktree-resultado");
  await page.close();

  // Worktrees with `detached` / `locked` badges, among the first in the list.
  page = await open();
  await page.mouse.move(0, 0);
  await shot(page, "estados");
  await page.close();

  // The view inside VS Code: a dark frame (activity bar + side bar) hosting the real UI.
  const vscode = await browser.newContext({ viewport: { width: 760, height: 520 }, deviceScaleFactor: 2 });
  page = await vscode.newPage();
  await page.setContent(`<!doctype html><style>
    *{box-sizing:border-box}body{margin:0;display:flex;height:100vh;background:#1e1e1e;font:13px system-ui,sans-serif;color:#ccc}
    .bar{width:48px;background:#333;display:flex;flex-direction:column;align-items:center;gap:22px;padding-top:14px}
    .bar i{width:22px;height:22px;border:2px solid #858585;border-radius:5px}.bar i.on{border-color:#fff;background:#fff3}
    .side{width:320px;background:#252526;display:flex;flex-direction:column}
    .side h1{margin:0;font-size:11px;letter-spacing:.08em;font-weight:400;padding:10px 20px}
    .side h2{margin:0;font-size:11px;font-weight:700;padding:4px 8px;letter-spacing:.04em}
    iframe{flex:1;border:0;background:#252526}
    .ed{flex:1;display:flex;align-items:center;justify-content:center;color:#858585;font-size:15px}
  </style><div class="bar"><i></i><i></i><i class="on"></i></div>
  <div class="side"><h1>WORKTREE</h1><h2>⌄ WORKTREES</h2><iframe src="${server.url}"></iframe></div>
  <div class="ed">Worktree</div>`);
  const frame = page.frameLocator("iframe");
  await frame.locator("#list li").first().waitFor();
  await page.evaluate(() => {
    const vars = {
      "--vscode-sideBar-background": "#252526", "--vscode-editor-background": "#1e1e1e", "--vscode-foreground": "#cccccc",
      "--vscode-descriptionForeground": "#9d9d9d", "--vscode-button-background": "#0e639c", "--vscode-button-foreground": "#ffffff",
      "--vscode-button-hoverBackground": "#1177bb", "--vscode-input-background": "#3c3c3c", "--vscode-input-foreground": "#cccccc",
      "--vscode-widget-border": "#454545", "--vscode-panel-border": "#454545", "--vscode-badge-background": "#4d4d4d",
      "--vscode-badge-foreground": "#ffffff", "--vscode-focusBorder": "#007fd4", "--vscode-list-hoverBackground": "#2a2d2e",
    };
    document.querySelector("iframe")!.contentWindow!.postMessage({ type: "vscode-theme", kind: "dark", vars }, "*");
  });
  await page.waitForTimeout(300);
  await shot(page, "vscode");
} finally {
  await browser.close();
  await server.close();
}
