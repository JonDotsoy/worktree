import { describe, expect, test } from "bun:test";
import { parseWorktreeList } from "./worktrees";

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
