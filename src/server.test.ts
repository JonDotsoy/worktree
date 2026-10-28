import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
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
