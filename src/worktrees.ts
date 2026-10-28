import { execFile } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Worktree {
  path: string;
  /** The main worktree, the first one listed by git. */
  main?: boolean;
  /** The worktree that `cwd` belongs to, the one the view is observing. */
  current?: boolean;
  head?: string;
  /** Committer date of HEAD, in seconds since the epoch. */
  committedAt?: number;
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

/** Most recent commit first; worktrees without a known commit date go last. */
export function sortByRecentCommit(worktrees: Worktree[]): Worktree[] {
  return [...worktrees].sort((a, b) => (b.committedAt ?? -Infinity) - (a.committedAt ?? -Infinity));
}

async function commitDates(cwd: string, heads: string[]): Promise<Map<string, number>> {
  const dates = new Map<string, number>();
  if (heads.length === 0) return dates;
  try {
    const { stdout } = await execFileAsync("git", ["show", "-s", "--format=%H %ct", ...heads, "--"], { cwd });
    for (const line of stdout.trim().split("\n")) {
      const [sha, timestamp] = line.split(" ");
      if (sha && timestamp) dates.set(sha, Number(timestamp));
    }
  } catch {
    // A missing object only costs the ordering; the list is still useful.
  }
  return dates;
}

/** Moves the current worktree to the top, keeping the order of the rest. */
function currentFirst(worktrees: Worktree[]): Worktree[] {
  return [...worktrees.filter((w) => w.current), ...worktrees.filter((w) => !w.current)];
}

/** Lists the worktrees, the current one first and then the most recent commit first. */
export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd });
  const worktrees = parseWorktreeList(stdout);
  if (worktrees[0]) worktrees[0].main = true;

  const { stdout: toplevel } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
  const current = worktrees.find((w) => w.path === toplevel.trim());
  if (current) current.current = true;

  const dates = await commitDates(cwd, [...new Set(worktrees.flatMap((w) => (w.head ? [w.head] : [])))]);
  for (const worktree of worktrees) {
    if (worktree.head) worktree.committedAt = dates.get(worktree.head);
  }
  return currentFirst(sortByRecentCommit(worktrees));
}

export interface CreateWorktreeInput {
  /** Branch to check out; created from `base` when it does not exist yet. */
  branch: string;
  /** Commit-ish for a new branch. Defaults to the current HEAD. */
  base?: string;
  /** Target directory. Defaults to a sibling of the main worktree, see `defaultWorktreePath`. */
  path?: string;
}

/** `/repos/app` + `feature/login` → `/repos/app-feature-login`. */
export function defaultWorktreePath(mainWorktreePath: string, branch: string): string {
  const slug = branch.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return join(dirname(mainWorktreePath), `${basename(mainWorktreePath)}-${slug}`);
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)));
  }
}

async function branchExists(cwd: string, branch: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/** Runs `git worktree add` and returns the path of the new worktree. */
export async function createWorktree(cwd: string, input: CreateWorktreeInput): Promise<string> {
  const branch = input.branch.trim();
  const base = input.base?.trim();
  if (!branch || branch.startsWith("-")) throw new Error("El nombre de la rama no es válido.");
  if (base?.startsWith("-")) throw new Error("La base no es válida.");
  await git(cwd, ["check-ref-format", "--branch", branch]);

  const main = (await listWorktrees(cwd)).find((w) => w.main);
  const path = input.path?.trim()
    ? resolve(cwd, input.path.trim())
    : defaultWorktreePath(main?.path ?? cwd, branch);

  const args = (await branchExists(cwd, branch))
    ? ["worktree", "add", "--", path, branch]
    : ["worktree", "add", "-b", branch, "--", path, ...(base ? [base] : [])];
  await git(cwd, args);
  return path;
}
