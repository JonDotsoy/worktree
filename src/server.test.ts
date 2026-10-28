import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startWebServer, type WebServer } from "./server";

let server: WebServer;
let repo: string;

beforeAll(async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "worktree-test-")));
  repo = join(root, "app");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
  server = await startWebServer(resolve(import.meta.dir, "..", "web"), { cwd: () => repo, open: async () => {} });
});

afterAll(() => server.close());

const put = (headers: Record<string, string>, body: unknown) =>
  fetch(`${server.url}api/worktrees/description`, { method: "PUT", headers, body: JSON.stringify(body) });
const trusted = () => ({ "Content-Type": "application/json", Origin: new URL(server.url).origin });

test("PUT /api/worktrees/description saves the description and returns the list", async () => {
  const response = await put(trusted(), { path: repo, description: "Rama principal" });
  expect(response.status).toBe(200);
  const data = (await response.json()) as { worktrees: { path: string; description?: string }[] };
  expect(data.worktrees[0]).toMatchObject({ path: repo, description: "Rama principal" });
});

test("PUT /api/worktrees/description is protected like the other writes", async () => {
  expect((await put({ "Content-Type": "application/json" }, { path: repo, description: "x" })).status).toBe(403);
  expect((await put({ ...trusted(), Origin: "http://evil.example" }, { path: repo, description: "x" })).status).toBe(403);
  expect((await put({ Origin: new URL(server.url).origin, "Content-Type": "text/plain" }, { path: repo, description: "x" })).status).toBe(403);
});

test("PUT /api/worktrees/description validates its input", async () => {
  expect((await put(trusted(), { path: repo, description: 1 })).status).toBe(400);
  expect((await put(trusted(), { path: "/nope", description: "x" })).status).toBe(400);
  expect((await put(trusted(), { path: repo, description: "x".repeat(501) })).status).toBe(400);
});

const putSettings = (headers: Record<string, string>, body: unknown) =>
  fetch(`${server.url}api/settings`, { method: "PUT", headers, body: JSON.stringify(body) });

test("PUT /api/settings saves the compact style, returns it and it reaches the worktree list", async () => {
  const response = await putSettings(trusted(), { compact: true });
  expect(response.status).toBe(200);
  expect(((await response.json()) as { compact: boolean }).compact).toBe(true);
  expect(((await (await fetch(`${server.url}api/worktrees`)).json()) as { compact: boolean }).compact).toBe(true);

  // Anything that is not a boolean is ignored.
  await putSettings(trusted(), { compact: "no" });
  expect(((await (await fetch(`${server.url}api/settings`)).json()) as { compact: boolean }).compact).toBe(true);

  expect(((await (await putSettings(trusted(), { compact: false })).json()) as { compact: boolean }).compact).toBe(false);
});

test("PUT /api/settings requires the same origin", async () => {
  expect((await putSettings({ "Content-Type": "application/json" }, { compact: true })).status).toBe(403);
});

const del = (headers: Record<string, string>, body: unknown) =>
  fetch(`${server.url}api/worktrees`, { method: "DELETE", headers, body: JSON.stringify(body) });

test("DELETE /api/worktrees asks for confirmation when there are changes, then removes", async () => {
  const created = await fetch(`${server.url}api/worktrees`, { method: "POST", headers: trusted(), body: JSON.stringify({ branch: "to-delete" }) });
  const { path } = (await created.json()) as { path: string };
  writeFileSync(join(path, "wip.txt"), "x");

  const dirty = await del(trusted(), { path });
  expect(dirty.status).toBe(409);
  expect(await dirty.json()).toMatchObject({ dirty: true, changes: 1 });

  const removed = await del(trusted(), { path, force: true });
  expect(removed.status).toBe(200);
  expect(((await removed.json()) as { worktrees: { path: string }[] }).worktrees.map((w) => w.path)).toEqual([repo]);
});

test("DELETE /api/worktrees is protected and refuses the main worktree", async () => {
  expect((await del({ "Content-Type": "application/json" }, { path: repo })).status).toBe(403);
  expect((await del({ ...trusted(), Origin: "http://evil.example" }, { path: repo })).status).toBe(403);
  expect((await del(trusted(), { path: repo, force: true })).status).toBe(400);
  expect((await del(trusted(), { path: 1 })).status).toBe(400);
});
