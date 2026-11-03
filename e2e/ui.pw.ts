import { test as base, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startWebServer } from "../src/server";

const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, stdio: "ignore" });

/** The UI served against a throwaway repo: `main`, a worktree on `feat/x` and two branches without worktree. */
const test = base.extend<{}, { app: { url: string; path: string; opened: string[] } }>({
  app: [
    async ({}, use) => {
      const dir = mkdtempSync(join(tmpdir(), "worktree-e2e-"));
      const path = join(dir, "app");
      git(dir, "init", "-q", "-b", "main", path);
      git(path, "commit", "-q", "--allow-empty", "-m", "init");
      git(path, "worktree", "add", "-q", "-b", "feat/x", join(dir, "app-x"));
      git(path, "branch", "free/one");
      git(path, "branch", "free/two");
      const origin = join(dir, "origin");
      git(dir, "init", "-q", "--bare", "-b", "main", origin);
      git(path, "remote", "add", "origin", origin);
      git(path, "push", "-q", "origin", "main", "main:remote-only");
      git(path, "fetch", "-q", "origin");
      const opened: string[] = [];
      const server = await startWebServer(resolve(__dirname, "..", "web"), { cwd: () => path, open: async (target: string) => void opened.push(target), locale: () => "en", version: "9.9.9" });
      await use({ url: server.url, path, opened });
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
});

test("lists the branches without a worktree and follows new ones live", async ({ page, app }) => {
  await page.goto(app.url);
  const section = page.locator("#free-branches");
  await expect(section.getByRole("heading")).toHaveText("Branches without a worktree");
  await expect(section.locator("li .name")).toHaveText(["free/one", "free/two", "origin/remote-only"]);

  git(app.path, "branch", "free/live");
  await expect(section.locator("li .name")).toHaveText(["free/live", "free/one", "free/two", "origin/remote-only"]);
});

test("settings shows the extension version at the bottom", async ({ page, app }) => {
  await page.goto(app.url);
  await page.locator("#settings-toggle").click();
  await expect(page.locator("#settings-version")).toHaveText("Version 9.9.9");
});

test("double-clicking a free branch creates its worktree and opens it in the IDE", async ({ page, app }) => {
  await page.goto(app.url);
  await page.locator("#free-branches li", { hasText: "free/two" }).dblclick();

  await expect(page.locator("#list li", { hasText: "free/two" })).toBeVisible();
  await expect(page.locator("#free-branches li")).not.toContainText(["free/two"]);
  await expect.poll(() => app.opened.length).toBe(1);
  expect(app.opened[0]).toContain("free-two");
});

test("remote branches show by default, can be hidden in settings and create a local branch", async ({ page, app }) => {
  await page.goto(app.url);
  const remote = page.locator("#free-branches li", { hasText: "origin/remote-only" });
  await expect(remote).toBeVisible();
  await expect(page.locator("#free-branches li", { hasText: "origin/main" })).toHaveCount(0);

  await page.locator("#settings-toggle").click();
  await page.locator("#settings [name=remoteBranches]").uncheck();
  await page.locator("#settings-close").click();
  await expect(remote).toHaveCount(0);

  await page.locator("#settings-toggle").click();
  await page.locator("#settings [name=remoteBranches]").check();
  await page.locator("#settings-close").click();
  await remote.dblclick();
  await expect(page.locator("#list li", { hasText: "remote-only" })).toBeVisible();
  await expect(remote).toHaveCount(0);
});

test("right-clicking a free branch offers to create its worktree", async ({ page, app }) => {
  await page.goto(app.url);
  const before = app.opened.length;
  // A late snapshot from earlier tests' git activity can redraw the list and close the menu; open it again.
  await expect(async () => {
    await page.locator("#free-branches li", { hasText: "free/one" }).click({ button: "right" });
    await expect(page.getByRole("menuitem")).toHaveText(["Create worktree"], { timeout: 1000 });
    await page.getByRole("menuitem", { name: "Create worktree" }).click({ timeout: 1000 });
  }).toPass();
  await expect(page.locator("#list li", { hasText: "free/one" })).toBeVisible();
  await expect.poll(() => app.opened.length).toBe(before + 1);

  // The menu of a worktree still has its own entries.
  await page.locator("#list li", { hasText: "feat/x" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Create worktree" })).toBeHidden();
  await expect(page.getByRole("menuitem", { name: "Open" })).toBeVisible();
});
