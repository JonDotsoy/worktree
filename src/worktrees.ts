import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Worktree {
  path: string;
  head?: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked?: string;
  prunable?: string;
}

/** Parses the output of `git worktree list --porcelain`. */
export function parseWorktreeList(output: string): Worktree[] {
  return output
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const worktree: Worktree = { path: "", bare: false, detached: false };
      for (const line of block.split("\n")) {
        const [key, ...rest] = line.split(" ");
        const value = rest.join(" ");
        switch (key) {
          case "worktree":
            worktree.path = value;
            break;
          case "HEAD":
            worktree.head = value;
            break;
          case "branch":
            worktree.branch = value.replace(/^refs\/heads\//, "");
            break;
          case "bare":
            worktree.bare = true;
            break;
          case "detached":
            worktree.detached = true;
            break;
          case "locked":
            worktree.locked = value;
            break;
          case "prunable":
            worktree.prunable = value;
            break;
        }
      }
      return worktree;
    });
}

export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd });
  return parseWorktreeList(stdout);
}
