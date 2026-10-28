import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
}, 30_000);

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

for (const compact of [false, true]) {
  test(`el menú ofrece Eliminar salvo en el principal, y pide confirmación si hay cambios (${compact ? "compacto" : "tarjeta"})`, async () => {
    const wt = join(dir, `app-del-${compact ? "c" : "t"}`);
    git(join(dir, "app"), "worktree", "add", "-q", "-b", `feat/del-${compact ? "c" : "t"}`, wt);
    writeFileSync(join(wt, "wip.txt"), "x");
    const page = await browser.newPage();
    if (compact) await page.addInitScript(() => localStorage.setItem("compact", "true"));
    await page.goto(server.url);
    const item = page.locator("#list li", { hasText: `feat/del-${compact ? "c" : "t"}` });
    await item.waitFor();

    await page.locator("#list li", { hasText: "principal" }).click({ button: "right" });
    expect(await page.locator("#menu-delete").isVisible()).toBe(false);
    await page.keyboard.press("Escape");

    await item.click({ button: "right" });
    await page.locator("#menu-delete").click();
    await page.locator("#confirm").waitFor();
    expect(await page.locator("#confirm-text").textContent()).toContain("1 cambio");
    await page.locator("#confirm-cancel").click();
    expect(await item.count()).toBe(1);

    await item.click({ button: "right" });
    await page.locator("#menu-delete").click();
    await page.locator("#confirm-ok").click();
    await item.waitFor({ state: "detached" });
    await page.close();
  });
}

test("el menú se abre con el teclado, se recorre con las flechas y devuelve el foco al cerrar", async () => {
  const page = await browser.newPage();
  await page.goto(server.url);
  const item = page.locator("#list li", { hasText: "feat/x" });
  await item.waitFor();
  await item.focus();
  await page.keyboard.press("Shift+F10");
  await page.locator("#menu").waitFor();
  expect(await page.evaluate("document.activeElement?.id")).toBe("menu-open");
  await page.keyboard.press("ArrowDown");
  expect(await page.evaluate("document.activeElement?.id")).toBe("menu-star");
  await page.keyboard.press("End");
  expect(await page.evaluate("document.activeElement?.id")).toBe("menu-delete");
  await page.keyboard.press("ArrowDown");
  expect(await page.evaluate("document.activeElement?.id")).toBe("menu-open");
  await page.keyboard.press("Escape");
  expect(await page.locator("#menu").isVisible()).toBe(false);
  expect(await page.evaluate("document.activeElement?.textContent?.includes('feat/x')")).toBe(true);
  await page.close();
});

test("el menú copia la ruta absoluta y la relativa a la carpeta abierta", async () => {
  const page = await browser.newPage();
  await page.goto(server.url);
  await page.evaluate("navigator.clipboard.writeText = async (text) => { window.__copied = text; }");
  const item = page.locator("#list li", { hasText: "feat/x" });
  await item.waitFor();
  await item.click({ button: "right", position: { x: 40, y: 20 } });
  await page.locator("#menu-copy-abs").click();
  await page.locator("#message", { hasText: "Copiado" }).waitFor();
  expect(await page.evaluate("window.__copied")).toBe(join(dir, "app-x"));

  await item.click({ button: "right", position: { x: 40, y: 20 } });
  await page.locator("#menu-copy-rel").click();
  await page.locator("#message", { hasText: "Copiado: ../app-x" }).waitFor();
  expect(await page.evaluate("window.__copied")).toBe("../app-x");
  await page.close();
});

test("el menú agrega y quita la estrella según el estado", async () => {
  const page = await browser.newPage();
  await page.goto(server.url);
  const item = page.locator("#list li", { hasText: "feat/x" });
  await item.waitFor();
  await item.click({ button: "right", position: { x: 40, y: 20 } });
  expect(await page.locator("#menu-star").textContent()).toContain("Agregar estrella");
  await page.locator("#menu-star").click();
  await page.locator("#list li", { hasText: "feat/x" }).locator("button.star.on").waitFor();

  await item.click({ button: "right", position: { x: 40, y: 20 } });
  expect(await page.locator("#menu-star").textContent()).toContain("Quitar estrella");
  await page.locator("#menu-star").click();
  await page.locator("#list li", { hasText: "feat/x" }).locator("button.star.on").waitFor({ state: "detached" });
  await page.close();
});

test("el buscador filtra los worktrees con Fuse.js, tolera errores de tipeo y Esc lo limpia", async () => {
  const page = await browser.newPage();
  await page.goto(server.url);
  await page.locator("#list li", { hasText: "feat/x" }).waitFor();
  expect(await page.locator("#list li").count()).toBeGreaterThan(1);

  await page.locator("#search").fill("feat/x");
  await page.waitForFunction("document.querySelectorAll('#list li').length === 1");
  expect(await page.locator("#list li").textContent()).toContain("feat/x");

  // Fuzzy: a typo still finds it, and so does a piece of the path.
  await page.locator("#search").fill("fet/x");
  await page.waitForFunction("document.querySelectorAll('#list li').length === 1");
  await page.locator("#search").fill("app-x");
  await page.waitForFunction("document.querySelectorAll('#list li').length === 1");

  await page.locator("#search").fill("zzzzqqqq");
  await page.waitForFunction("document.querySelectorAll('#list li').length === 0");
  expect(await page.locator("#empty").isVisible()).toBe(true);

  await page.locator("#search").press("Escape");
  await page.waitForFunction("document.querySelectorAll('#list li').length > 1");
  expect(await page.locator("#empty").isVisible()).toBe(false);
  await page.close();
});
