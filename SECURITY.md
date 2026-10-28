# Security

This document describes what the **Worktree** extension does on your machine: which files it creates and reads, which commands it runs, and what it exposes on the network. It reflects the code in `src/` and `web/`.

## Reporting a vulnerability

If you find a security issue, email **hi@jon.soy** with a description, the steps to reproduce it, and the affected version. Please do not open a public issue with the details until a fix is available.

## Who to notify

- **Vulnerabilities and security patches:** the maintainer, [@JonDotsoy](https://github.com/JonDotsoy), at **hi@jon.soy**. They are the only person responsible for the project and review every pull request (see `CODEOWNERS`).
- **Proposed patches:** if you already have a fix, describe it in the same email, or send it as a pull request against `develop` once disclosure has been agreed. Until then, do not publish it.
- **Non-security bugs:** open an issue at [github.com/JonDotsoy/worktree/issues](https://github.com/JonDotsoy/worktree/issues).

Security fixes are shipped in a new version of the extension, available from [Releases](https://github.com/JonDotsoy/worktree/releases).

## Summary

- The extension **does not send data to the internet**. There is no telemetry and no calls to external services.
- It only runs `git` and, when opening a worktree, `code`. Always with separate arguments, **never through a shell**.
- It starts a local HTTP server that listens only on `127.0.0.1`.

## Files and folders it creates or modifies

Everything happens inside the open repository (the first workspace folder).

| Path | When | What is written |
| --- | --- | --- |
| `<project root>/.worktree/` | When creating the first worktree with the default folder | Folder that holds new worktrees. |
| `<project root>/.worktree/.gitignore` | Together with the folder above | A single line, `*`, so git does not list its contents. Only created if it does not exist. |
| `<project root>/.worktree/<branch>/` | When creating a worktree | Created by `git worktree add`. The name comes from the branch, with any character that is not `\w`, `.` or `-` replaced by `-`. |
| A path you choose | When creating a worktree with your own folder (path in the form or configured folder) | Created by `git worktree add`. It is resolved relative to the project and may be absolute or outside the repository. |
| `.git/_worktree_configs/settings.json` | When saving the settings | JSON with `baseBranch` and `worktreesDir`. In a linked worktree it uses the common git directory, that is, the `.git` of the main worktree. |
| `.git/worktrees/…`, refs and the `.git` file of each worktree | When creating a worktree | Written by `git worktree add`, not by the extension directly. |

The extension **does not modify** your source files or your VS Code settings. It also deletes nothing: it does not remove worktrees, branches or folders.

## Files it reads

- `.git/_worktree_configs/settings.json`, for the base branch and the worktrees folder.
- The static files in `web/` inside the extension, which the local server serves.
- The output of `git`, which is where all worktree and branch information comes from.
- It watches the common git directory with `fs.watch` (recursive) to refresh the list when it changes. It does not read the contents of those files: it only reacts to the event and runs `git` again.

## Commands it runs

All of them use `execFile` or `spawn` with an argument array (no `shell`), so neither branch names nor paths are interpreted as shell commands. The working directory is the open project.

| Command | Purpose |
| --- | --- |
| `git worktree list --porcelain` | List the worktrees. |
| `git rev-parse --show-toplevel` | Find out which worktree is the current one. |
| `git rev-parse --path-format=absolute --git-common-dir` | Locate the common git directory. |
| `git show -s --format=%H %ct <commits> --` | Commit dates, used to sort the list. |
| `git for-each-ref --format=%(refname:short) refs/heads refs/remotes` | Suggest branches. |
| `git rev-parse --verify --quiet refs/heads/<branch>` | Check whether a branch exists. |
| `git rev-parse --verify --quiet <base>^{commit}` | Validate the base branch when saving it. |
| `git check-ref-format --branch <branch>` | Validate the branch name when creating a worktree. |
| `git worktree add -- <path> <branch>` | Create a worktree for an existing branch. |
| `git worktree add -b <branch> -- <path> [<base>]` | Create a worktree with a new branch. |
| `code <path>` | Open a worktree in a new window. |

About `code <path>`:

- It is launched with `spawn("code", [path], { detached: true, stdio: "ignore" })`, without a shell.
- It receives the process environment without the `VSCODE_*` variables and `ELECTRON_RUN_AS_NODE`, so it behaves like an invocation from a terminal.
- If `code` is not on the `PATH`, it falls back to the built-in `vscode.openFolder` command in a new window.
- Only paths that `git worktree list` reports as worktrees of the current repository are opened.

Validations: branch names and bases that start with `-` are rejected, and `--` is passed before paths so git does not mistake them for options.

## Local server

The sidebar view is an `iframe` that loads a page served by the extension itself.

- **Host and port:** `127.0.0.1`, a random port assigned by the operating system. It is not reachable from other machines.
- **When:** it starts the first time the view is shown and closes when the extension is deactivated.
- **Routes:**
  - `GET /api/worktrees/events`: Server-Sent Events (SSE) with the worktree list, the project directory and your home directory. It sends a heartbeat every 25 s.
  - `GET /api/worktrees`: the same information as JSON.
  - `POST /api/worktrees`: creates a worktree.
  - `POST /api/worktrees/open`: opens a worktree (only those listed by git).
  - `GET` and `PUT /api/settings`: read and save the base branch and the worktrees folder, and return the available branches.
  - Any other route serves static files from `web/`, checking that the path does not escape that folder.
- **Write protection:** `POST` and `PUT` require `Host` equal to `127.0.0.1` or `localhost`, an `Origin` header equal to the server's own, and `Content-Type: application/json`. This prevents other websites from making changes (CSRF) or using DNS rebinding to write. The body is limited to 64 KiB.
- **CORS:** no CORS headers are sent.

### Known limitations

- `GET` requests have no authentication and validate neither `Host` nor `Origin`. Any process or user on the same machine that knows the port can read the worktree list (paths, branches, commits and your home directory). A website cannot read them because of CORS, but a DNS rebinding attack could. Operations that change something are protected.
- `POST` and `PUT` also carry no token. A malicious local process can send the correct `Host` and `Origin` and create worktrees or change the settings, but that already requires running code on your machine.
- If you work with remote VS Code (SSH, containers, Codespaces), VS Code forwards the port with `asExternalUri`. In that case the server runs on the remote machine.

## Clipboard

The copy button uses `navigator.clipboard.writeText` (with `document.execCommand("copy")` as a fallback) to copy a worktree's path. It only **writes** to the clipboard when you click the button; it never reads it.

## Network

The extension makes no requests to external servers. The only communication is between the `iframe` and the local server on `127.0.0.1`. The content security policy of the VS Code view only allows framing the local server's origin.
