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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const { setBaseBranch, setWorktreeDescription } = await import("../src/worktrees");

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
await setWorktreeDescription(app, join(projects, "app-login"), "Formulario de inicio de sesión con OAuth. Pendiente: pruebas e2e.");
await setWorktreeDescription(app, join(projects, "app-fix"), "Corrige el error al listar sin elementos.");
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

  // Editing a description inline: it saves when the field loses focus.
  page = await open();
  await page.locator("#list li", { hasText: "main" }).first().getByRole("button", { name: "Agregar descripción" }).click();
  await page.locator("#list textarea").fill("Rama estable; de aquí salen las demás.");
  await shot(page, "descripcion-editar");
  await page.locator("h1").click();
  await page.locator("#list li", { hasText: "Rama estable" }).waitFor();
  await shot(page, "descripcion");
  await page.locator("#list li", { hasText: "fix/bug" }).locator(".date").hover();
  await shot(page, "fecha-completa");
  await setWorktreeDescription(app, app, "");
  await page.close();

  page = await open();
  await page.locator("#list li", { hasText: "feat/login" }).getByRole("button", { name: "Copiar ruta" }).click();
  await page.locator("#list li .copy.copied").waitFor();
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

  // Compact style: switched on from the settings, rows instead of cards.
  page = await open();
  await page.click("#settings-toggle");
  await page.locator("#settings:not([hidden])").waitFor();
  await page.check("[name=compact]");
  await page.locator("#settings-message", { hasText: "Guardado" }).waitFor();
  await page.click("#settings-close");
  await page.locator("#list.compact li").first().waitFor();
  await page.mouse.move(0, 0);
  await shot(page, "estilo-compacto");
  await page.click("#settings-toggle");
  await page.locator("#settings:not([hidden])").waitFor();
  await shot(page, "configuracion-compacto");
  await page.uncheck("[name=compact]");
  await page.locator("#list.compact").waitFor({ state: "detached" });
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

  // The view inside VS Code: a frame (activity bar + side bar) hosting the real UI, dark and light.
  const themes = {
    dark: {
      file: "vscode", kind: "dark", frame: { page: "#1e1e1e", bar: "#333", barIcon: "#858585", barOn: "#fff", side: "#252526", fg: "#ccc", muted: "#858585" },
      vars: {
        "--vscode-sideBar-background": "#252526", "--vscode-editor-background": "#1e1e1e", "--vscode-foreground": "#cccccc",
        "--vscode-descriptionForeground": "#9d9d9d", "--vscode-button-background": "#0e639c", "--vscode-button-foreground": "#ffffff",
        "--vscode-button-hoverBackground": "#1177bb", "--vscode-input-background": "#3c3c3c", "--vscode-input-foreground": "#cccccc",
        "--vscode-widget-border": "#454545", "--vscode-panel-border": "#454545", "--vscode-badge-background": "#4d4d4d",
        "--vscode-badge-foreground": "#ffffff", "--vscode-focusBorder": "#007fd4", "--vscode-list-hoverBackground": "#2a2d2e",
      },
    },
    light: {
      file: "vscode-claro", kind: "light", frame: { page: "#ffffff", bar: "#2c2c2c", barIcon: "#c5c5c5", barOn: "#fff", side: "#f3f3f3", fg: "#616161", muted: "#8a8a8a" },
      vars: {
        "--vscode-sideBar-background": "#f3f3f3", "--vscode-editor-background": "#ffffff", "--vscode-foreground": "#616161",
        "--vscode-descriptionForeground": "#717171", "--vscode-button-background": "#007acc", "--vscode-button-foreground": "#ffffff",
        "--vscode-button-hoverBackground": "#0062a3", "--vscode-input-background": "#ffffff", "--vscode-input-foreground": "#616161",
        "--vscode-widget-border": "#c8c8c8", "--vscode-panel-border": "#c8c8c8", "--vscode-badge-background": "#c4c4c4",
        "--vscode-badge-foreground": "#333333", "--vscode-focusBorder": "#0090f1", "--vscode-list-hoverBackground": "#e8e8e8",
      },
    },
  };
  const worktreeIcon = readFileSync(resolve(root, "media/worktree.svg"), "utf8");
  const vscode = await browser.newContext({ viewport: { width: 760, height: 520 }, deviceScaleFactor: 2 });
  for (const theme of Object.values(themes)) {
    const f = theme.frame;
    page = await vscode.newPage();
    await page.setContent(`<!doctype html><style>
    *{box-sizing:border-box}body{margin:0;display:flex;height:100vh;background:${f.page};font:13px system-ui,sans-serif;color:${f.fg}}
    .bar{width:48px;background:${f.bar};display:flex;flex-direction:column;align-items:center;gap:22px;padding-top:14px}
    .bar i{width:22px;height:22px;border:2px solid ${f.barIcon};border-radius:5px}.bar svg{width:24px;height:24px;color:${f.barOn}}
    .side{width:320px;background:${f.side};display:flex;flex-direction:column}
    .side h1{margin:0;font-size:11px;letter-spacing:.08em;font-weight:400;padding:10px 20px}
    .side h2{margin:0;font-size:11px;font-weight:700;padding:4px 8px;letter-spacing:.04em}
    iframe{flex:1;border:0;background:${f.side}}
    .ed{flex:1;display:flex;align-items:center;justify-content:center;color:${f.muted};font-size:15px}
  </style><div class="bar"><i></i><i></i>${worktreeIcon}</div>
  <div class="side"><h1>WORKTREE</h1><h2>⌄ WORKTREES</h2><iframe src="${server.url}"></iframe></div>
  <div class="ed">Worktree</div>`);
    const frame = page.frameLocator("iframe");
    await frame.locator("#list li").first().waitFor();
    await page.evaluate(({ kind, vars }) => {
      document.querySelector("iframe")!.contentWindow!.postMessage({ type: "vscode-theme", kind, vars }, "*");
    }, { kind: theme.kind, vars: theme.vars });
    await page.waitForTimeout(300);
    await shot(page, theme.file);
    // Copy feedback: the clipboard icon turns into a check.
    await frame.locator("#list li", { hasText: "feat/login" }).getByRole("button", { name: "Copiar ruta" }).click();
    await frame.locator(".copy.copied").first().waitFor();
    await shot(page, `${theme.file}-copiado`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
