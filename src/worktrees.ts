import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  /** Free-text note the user attached to the worktree, see `setWorktreeDescription`. */
  description?: string;
  /** Marked with a star by the user, see `setWorktreeStarred`. */
  starred?: boolean;
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

/** Moves the current worktree to the top, then the starred ones, keeping the order of the rest. */
function currentFirst(worktrees: Worktree[]): Worktree[] {
  const rank = (w: Worktree) => (w.current ? 0 : w.starred ? 1 : 2);
  return [...worktrees].sort((a, b) => rank(a) - rank(b));
}

/** Lists the worktrees: the current one first, then the starred ones, then the most recent commit first. */
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
  const descriptions = await readDescriptions(cwd);
  for (const worktree of worktrees) {
    const description = descriptions[worktree.path];
    if (description) worktree.description = description;
  }
  const starred = new Set(await readStarred(cwd));
  for (const worktree of worktrees) {
    if (starred.has(worktree.path)) worktree.starred = true;
  }
  return currentFirst(sortByRecentCommit(worktrees));
}

export interface CreateWorktreeInput {
  /** Branch to check out; created from `base` when it does not exist yet. */
  branch: string;
  /** Commit-ish for a new branch. Defaults to the configured base branch, then the current HEAD. */
  base?: string;
  /** Target directory. Defaults to `<worktrees dir>/<branch>` under the project root, see `defaultWorktreePath`. */
  path?: string;
}

/** Folder for new worktrees when none is configured, relative to the project root. */
export const DEFAULT_WORKTREES_DIR = ".worktree";

/** `feature/login` → `feature-login`; also used by the page to preview the path. */
export function branchSlug(branch: string): string {
  return branch.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** `/repos/app` + `feature/login` → `/repos/app/.worktree/feature-login`. */
export function defaultWorktreePath(mainWorktreePath: string, branch: string, dir = DEFAULT_WORKTREES_DIR): string {
  return resolve(mainWorktreePath, dir, branchSlug(branch));
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

/** The git dir shared by every worktree of the repo, i.e. the `.git` of the main worktree. */
export async function gitCommonDir(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
}

/** Where the view keeps its settings: `<common git dir>/_worktree_configs/settings.json`. */
async function settingsFile(cwd: string): Promise<string> {
  return join(await gitCommonDir(cwd), "_worktree_configs", "settings.json");
}

interface Settings {
  baseBranch?: string;
  worktreesDir?: string;
  /** Show the list as dense rows instead of cards. */
  compact?: boolean;
}

async function readSettings(cwd: string): Promise<Settings> {
  try {
    return JSON.parse(await readFile(await settingsFile(cwd), "utf8")) as Settings;
  } catch {
    return {};
  }
}

/** Branch new worktrees are created from; empty when unset (git then uses HEAD). */
export async function getBaseBranch(cwd: string): Promise<string> {
  const { baseBranch } = await readSettings(cwd);
  return typeof baseBranch === "string" ? baseBranch : "";
}

async function writeSetting<K extends keyof Settings>(cwd: string, key: K, value: Settings[K]): Promise<void> {
  const file = await settingsFile(cwd);
  const settings = await readSettings(cwd);
  if (value) settings[key] = value;
  else delete settings[key];
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Stores the base branch in the settings file; an empty value clears it. */
export async function setBaseBranch(cwd: string, value: string): Promise<void> {
  const base = value.trim();
  if (base) {
    if (base.startsWith("-")) throw new Error("La base no es válida.");
    await git(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]).catch(() => {
      throw new Error(`La rama "${base}" no existe.`);
    });
  }
  await writeSetting(cwd, "baseBranch", base);
}

/** Folder new worktrees go in, relative to the project root unless absolute. */
export async function getWorktreesDir(cwd: string): Promise<string> {
  const { worktreesDir } = await readSettings(cwd);
  return typeof worktreesDir === "string" && worktreesDir ? worktreesDir : DEFAULT_WORKTREES_DIR;
}

/** Stores the worktrees folder; an empty value goes back to the default. */
export async function setWorktreesDir(cwd: string, value: string): Promise<void> {
  const dir = value.trim();
  if (dir === DEFAULT_WORKTREES_DIR || dir === `${DEFAULT_WORKTREES_DIR}/`) return writeSetting(cwd, "worktreesDir", "");
  await writeSetting(cwd, "worktreesDir", dir);
}

/** Whether the list is shown as compact rows instead of cards. */
export async function getCompact(cwd: string): Promise<boolean> {
  return (await readSettings(cwd)).compact === true;
}

/** Stores the list style; `false` removes the key, going back to cards. */
export async function setCompact(cwd: string, value: boolean): Promise<void> {
  await writeSetting(cwd, "compact", value);
}

/** Longest description accepted, in characters. */
export const MAX_DESCRIPTION_LENGTH = 500;

/** Descriptions live next to the settings, keyed by the absolute path of each worktree. */
async function descriptionsFile(cwd: string): Promise<string> {
  return join(await gitCommonDir(cwd), "_worktree_configs", "descriptions.json");
}

async function readDescriptions(cwd: string): Promise<Record<string, string>> {
  try {
    const data: unknown = JSON.parse(await readFile(await descriptionsFile(cwd), "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

/**
 * Stores the description of a worktree listed by git; an empty value clears it.
 * Entries of worktrees git no longer lists are dropped on each save, so the file does
 * not grow; the cleanup only runs after git listed the worktrees successfully.
 */
export async function setWorktreeDescription(cwd: string, path: string, value: string): Promise<void> {
  const description = value.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`La descripción no puede superar ${MAX_DESCRIPTION_LENGTH} caracteres.`);
  }
  const listed = new Set((await listWorktrees(cwd)).map((w) => w.path));
  if (!listed.has(path)) throw new Error("No existe ese worktree.");

  const descriptions = await readDescriptions(cwd);
  for (const key of Object.keys(descriptions)) {
    if (!listed.has(key)) delete descriptions[key];
  }
  if (description) descriptions[path] = description;
  else delete descriptions[path];

  const file = await descriptionsFile(cwd);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(descriptions, null, 2)}\n`);
}

/** Starred worktrees live next to the settings, as a list of absolute paths. */
async function starredFile(cwd: string): Promise<string> {
  return join(await gitCommonDir(cwd), "_worktree_configs", "starred.json");
}

async function readStarred(cwd: string): Promise<string[]> {
  try {
    const data: unknown = JSON.parse(await readFile(await starredFile(cwd), "utf8"));
    return Array.isArray(data) ? data.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Adds or removes the star of a worktree listed by git.
 * Like descriptions, entries of worktrees git no longer lists are dropped on each save.
 */
export async function setWorktreeStarred(cwd: string, path: string, starred: boolean): Promise<void> {
  const listed = new Set((await listWorktrees(cwd)).map((w) => w.path));
  if (!listed.has(path)) throw new Error("No existe ese worktree.");

  const paths = new Set((await readStarred(cwd)).filter((entry) => listed.has(entry)));
  if (starred) paths.add(path);
  else paths.delete(path);

  const file = await starredFile(cwd);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify([...paths], null, 2)}\n`);
}

/** Local and remote branch names, for suggestions. */
export async function listBranches(cwd: string): Promise<string[]> {
  const out = await git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]);
  return out.split("\n").filter((name) => name && !name.endsWith("/HEAD"));
}

/** Creates the default worktrees folder with a `.gitignore` of `*`, so git never lists its contents. */
async function ensureIgnoredDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".gitignore"), "*\n", { flag: "wx" }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
}

/** Runs `git worktree add` and returns the path of the new worktree. */
export async function createWorktree(cwd: string, input: CreateWorktreeInput): Promise<string> {
  const branch = input.branch.trim();
  const base = input.base?.trim() || (await getBaseBranch(cwd));
  if (!branch || branch.startsWith("-")) throw new Error("El nombre de la rama no es válido.");
  if (base?.startsWith("-")) throw new Error("La base no es válida.");
  await git(cwd, ["check-ref-format", "--branch", branch]);

  const main = (await listWorktrees(cwd)).find((w) => w.main);
  let path: string;
  if (input.path?.trim()) {
    path = resolve(cwd, input.path.trim());
  } else {
    const dir = await getWorktreesDir(cwd);
    path = defaultWorktreePath(main?.path ?? cwd, branch, dir);
    if (dir === DEFAULT_WORKTREES_DIR) await ensureIgnoredDir(resolve(main?.path ?? cwd, dir));
  }

  const args = (await branchExists(cwd, branch))
    ? ["worktree", "add", "--", path, branch]
    : ["worktree", "add", "-b", branch, "--", path, ...(base ? [base] : [])];
  await git(cwd, args);
  return path;
}

/** Number of entries `git status` reports in a worktree: staged, unstaged and untracked changes. */
export async function countChanges(path: string): Promise<number> {
  const out = await git(path, ["status", "--porcelain"]);
  return out.split("\n").filter(Boolean).length;
}

/** Thrown by `removeWorktree` when the worktree has changes and `force` was not set. */
export class DirtyWorktreeError extends Error {
  constructor(readonly changes: number) {
    super(`El worktree tiene ${changes} cambio(s) sin confirmar.`);
  }
}

/**
 * Runs `git worktree remove` on a worktree listed by git. The main worktree and the one
 * `cwd` belongs to cannot be removed. With uncommitted changes it throws `DirtyWorktreeError`
 * unless `force` is set. The branch is kept.
 */
export async function removeWorktree(cwd: string, path: string, force = false): Promise<void> {
  const worktrees = await listWorktrees(cwd);
  const target = worktrees.find((w) => w.path === path);
  if (!target) throw new Error("No existe ese worktree.");
  if (target.main) throw new Error("No se puede eliminar el worktree principal.");
  if (target.current) throw new Error("No se puede eliminar el worktree abierto en VS Code.");

  if (!force && !target.prunable) {
    const changes = await countChanges(target.path);
    if (changes > 0) throw new DirtyWorktreeError(changes);
  }
  const main = worktrees.find((w) => w.main);
  await git(main?.path ?? cwd, ["worktree", "remove", ...(force ? ["--force"] : []), "--", target.path]);
}
