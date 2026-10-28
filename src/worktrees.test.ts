import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree, defaultWorktreePath, listWorktrees, parseWorktreeList } from "./worktrees";

describe("parseWorktreeList", () => {
  test("parses branches, detached, bare, locked and prunable worktrees", () => {
    const output = [
      "worktree /repo",
      "bare",
      "",
      "worktree /repo/main",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /repo/fix",
      "HEAD 2222222222222222222222222222222222222222",
      "detached",
      "locked in use",
      "",
      "worktree /repo/old dir",
      "HEAD 3333333333333333333333333333333333333333",
      "branch refs/heads/feature/old",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");

    expect(parseWorktreeList(output)).toEqual([
      { path: "/repo", bare: true, detached: false },
      { path: "/repo/main", head: "1111111111111111111111111111111111111111", branch: "main", bare: false, detached: false },
      { path: "/repo/fix", head: "2222222222222222222222222222222222222222", bare: false, detached: true, locked: "in use" },
      {
        path: "/repo/old dir",
        head: "3333333333333333333333333333333333333333",
        branch: "feature/old",
        bare: false,
        detached: false,
        prunable: "gitdir file points to non-existent location",
      },
    ]);
  });

  test("returns an empty list for empty output", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });
});

describe("defaultWorktreePath", () => {
  test("creates a sibling directory named after the branch", () => {
    expect(defaultWorktreePath("/repos/app", "feature/login")).toBe("/repos/app-feature-login");
    expect(defaultWorktreePath("/repos/app", "fix it!")).toBe("/repos/app-fix-it");
  });
});

describe("createWorktree", () => {
  function initRepo(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "worktree-test-")));
    const repo = join(root, "app");
    const run = (...args: string[]) => execFileSync("git", args, { cwd: root });
    run("init", "-q", "-b", "main", repo);
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
    return repo;
  }

  test("creates a new branch in the default path", async () => {
    const repo = initRepo();
    const path = await createWorktree(repo, { branch: "feature/login" });
    expect(path).toBe(`${repo}-feature-login`);
    const worktrees = await listWorktrees(repo);
    expect(worktrees.map((w) => [w.path, w.branch])).toEqual([
      [repo, "main"],
      [path, "feature/login"],
    ]);
  });

  test("checks out an existing branch in a custom path", async () => {
    const repo = initRepo();
    execFileSync("git", ["branch", "existing"], { cwd: repo });
    const path = await createWorktree(repo, { branch: "existing", path: "../custom" });
    expect(path).toBe(join(repo, "..", "custom"));
    expect((await listWorktrees(repo))[1]?.branch).toBe("existing");
  });

  test("rejects invalid branch names", async () => {
    const repo = initRepo();
    await expect(createWorktree(repo, { branch: "--force" })).rejects.toThrow();
    await expect(createWorktree(repo, { branch: "bad..name" })).rejects.toThrow();
  });
});
