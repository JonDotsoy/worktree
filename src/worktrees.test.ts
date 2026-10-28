import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree, defaultWorktreePath, getBaseBranch, getCompact, getWorktreesDir, listBranches, listWorktrees, MAX_DESCRIPTION_LENGTH, parseWorktreeList, setBaseBranch, setCompact, setWorktreeDescription, setWorktreesDir, sortByRecentCommit } from "./worktrees";

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
  test("creates a directory named after the branch inside the worktrees folder", () => {
    expect(defaultWorktreePath("/repos/app", "feature/login")).toBe("/repos/app/.worktree/feature-login");
    expect(defaultWorktreePath("/repos/app", "fix it!")).toBe("/repos/app/.worktree/fix-it");
    expect(defaultWorktreePath("/repos/app", "foo", "../trees")).toBe("/repos/trees/foo");
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
    expect(path).toBe(join(repo, ".worktree", "feature-login"));
    expect(readFileSync(join(repo, ".worktree", ".gitignore"), "utf8")).toBe("*\n");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo }).toString()).toBe("");
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

describe("sortByRecentCommit", () => {
  test("puts the most recent commit first and unknown dates last", () => {
    const worktree = (path: string, committedAt?: number) => ({ path, committedAt, bare: false, detached: false });
    expect(sortByRecentCommit([worktree("a", 1), worktree("b"), worktree("c", 3), worktree("d", 2)]).map((w) => w.path)).toEqual([
      "c",
      "d",
      "a",
      "b",
    ]);
  });
});

describe("listWorktrees", () => {
  test("orders worktrees by their latest commit and keeps the main flag", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "worktree-test-")));
    const repo = join(root, "app");
    const commit = (cwd: string, date: string) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", date], {
        cwd,
        env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
      });
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    commit(repo, "2024-01-01T00:00:00Z");
    execFileSync("git", ["worktree", "add", "-q", "-b", "old", "../old"], { cwd: repo });
    execFileSync("git", ["worktree", "add", "-q", "-b", "new", "../new"], { cwd: repo });
    commit(join(root, "new"), "2024-03-01T00:00:00Z");
    commit(repo, "2024-02-01T00:00:00Z");

    const worktrees = await listWorktrees(join(root, "new"));
    expect(worktrees.map((w) => [w.branch, w.main ?? false])).toEqual([
      ["new", false],
      ["main", true],
      ["old", false],
    ]);
    expect(worktrees[0]?.committedAt).toBe(Date.parse("2024-03-01T00:00:00Z") / 1000);

    // The worktree being observed goes first, even from a subfolder and when it is the oldest.
    mkdirSync(join(root, "old", "sub"));
    const fromOld = await listWorktrees(join(root, "old", "sub"));
    expect(fromOld.map((w) => [w.branch, w.current ?? false])).toEqual([
      ["old", true],
      ["new", false],
      ["main", false],
    ]);
  });
});

describe("base branch setting", () => {
  test("is stored under .git/_worktree_configs, validated, and used by createWorktree", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "worktree-test-")));
    const repo = join(root, "app");
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo }).toString().trim();
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    git("commit", "-q", "--allow-empty", "-m", "one");
    git("branch", "develop");
    git("commit", "-q", "--allow-empty", "-m", "two");

    expect(await getBaseBranch(repo)).toBe("");
    expect(await listBranches(repo)).toEqual(["develop", "main"]);
    await expect(setBaseBranch(repo, "nope")).rejects.toThrow();

    await setBaseBranch(repo, "develop");
    expect(await getBaseBranch(repo)).toBe("develop");
    await createWorktree(repo, { branch: "feature" });
    expect(git("rev-parse", "feature")).toBe(git("rev-parse", "develop"));

    expect(JSON.parse(readFileSync(join(repo, ".git", "_worktree_configs", "settings.json"), "utf8"))).toEqual({
      baseBranch: "develop",
    });

    await setBaseBranch(repo, "");
    expect(await getBaseBranch(repo)).toBe("");

    expect(await getWorktreesDir(repo)).toBe(".worktree");
    await setWorktreesDir(repo, "../trees");
    expect(await getWorktreesDir(repo)).toBe("../trees");
    expect(await createWorktree(repo, { branch: "other" })).toBe(join(root, "trees", "other"));
    await setWorktreesDir(repo, "");
    expect(await getWorktreesDir(repo)).toBe(".worktree");
  });
});

describe("compact style setting", () => {
  test("is stored next to the other settings and removed when turned off", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "worktree-test-")));
    const repo = join(root, "app");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    const file = join(repo, ".git", "_worktree_configs", "settings.json");

    expect(await getCompact(repo)).toBe(false);
    await setCompact(repo, true);
    expect(await getCompact(repo)).toBe(true);
    await setWorktreesDir(repo, "../trees");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ compact: true, worktreesDir: "../trees" });

    await setCompact(repo, false);
    expect(await getCompact(repo)).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ worktreesDir: "../trees" });
  });
});

describe("worktree descriptions", () => {
  function setup() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "worktree-test-")));
    const repo = join(root, "app");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
    return { root, repo };
  }
  const file = (repo: string) => join(repo, ".git", "_worktree_configs", "descriptions.json");

  test("are stored in the common git dir, shared by every worktree, and cleared when empty", async () => {
    const { repo } = setup();
    const other = await createWorktree(repo, { branch: "feature" });
    await setWorktreeDescription(other, other, "  Trabajo de login\nsegunda línea  ");
    expect(JSON.parse(readFileSync(file(repo), "utf8"))).toEqual({ [other]: "Trabajo de login\nsegunda línea" });

    const fromMain = await listWorktrees(repo);
    expect(fromMain.find((w) => w.path === other)?.description).toBe("Trabajo de login\nsegunda línea");
    expect(fromMain.find((w) => w.main)?.description).toBeUndefined();

    await setWorktreeDescription(repo, other, "  ");
    expect(JSON.parse(readFileSync(file(repo), "utf8"))).toEqual({});
    expect((await listWorktrees(repo)).every((w) => w.description === undefined)).toBe(true);
  });

  test("rejects unknown worktrees and texts over the limit", async () => {
    const { repo, root } = setup();
    await expect(setWorktreeDescription(repo, join(root, "nope"), "x")).rejects.toThrow("No existe");
    await expect(setWorktreeDescription(repo, repo, "x".repeat(MAX_DESCRIPTION_LENGTH + 1))).rejects.toThrow("500");
    await setWorktreeDescription(repo, repo, "x".repeat(MAX_DESCRIPTION_LENGTH));
    expect((await listWorktrees(repo))[0]?.description).toHaveLength(MAX_DESCRIPTION_LENGTH);
  });

  test("drops entries of worktrees git no longer lists, keeping the rest", async () => {
    const { repo } = setup();
    const a = await createWorktree(repo, { branch: "a" });
    const b = await createWorktree(repo, { branch: "b" });
    await setWorktreeDescription(repo, a, "nota a");
    await setWorktreeDescription(repo, b, "nota b");
    execFileSync("git", ["worktree", "remove", "--force", a], { cwd: repo });
    await setWorktreeDescription(repo, repo, "principal");
    expect(JSON.parse(readFileSync(file(repo), "utf8"))).toEqual({ [b]: "nota b", [repo]: "principal" });
  });

  test("a missing or corrupt file is treated as empty", async () => {
    const { repo } = setup();
    mkdirSync(join(repo, ".git", "_worktree_configs"), { recursive: true });
    writeFileSync(file(repo), "{not json");
    expect((await listWorktrees(repo))[0]?.description).toBeUndefined();
    await setWorktreeDescription(repo, repo, "ok");
    expect((await listWorktrees(repo))[0]?.description).toBe("ok");
  });
});
