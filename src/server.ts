import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { createWorktree, getBaseBranch, getCompact, getWorktreesDir, gitCommonDir, listBranches, listWorktrees, setBaseBranch, setCompact, setWorktreeDescription, setWorktreesDir } from "./worktrees";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export interface WebServer {
  url: string;
  close(): Promise<void>;
}

/** Debounce for bursts of file events: one git command touches many files under `.git`. */
const WATCH_DEBOUNCE_MS = 150;
const HEARTBEAT_MS = 25_000;

/**
 * Streams the worktree list over SSE: once on connect and again whenever the git data changes.
 * Every worktree's metadata lives under the common git dir, so watching it covers them all.
 */
async function streamWorktrees(req: IncomingMessage, res: ServerResponse, cwd: string | undefined): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = "";
  let closed = false;

  const publish = async () => {
    if (closed) return;
    if (!cwd) {
      send("failure", { error: "No hay una carpeta abierta en VS Code." });
      return;
    }
    try {
      const payload = { cwd, home: homedir(), compact: await getCompact(cwd), worktrees: await listWorktrees(cwd) };
      const json = JSON.stringify(payload);
      if (json === last || closed) return;
      last = json;
      send("worktrees", payload);
    } catch (error) {
      send("failure", { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(timer);
    watcher?.close();
  });

  await publish();
  if (!cwd || closed) return;
  try {
    watcher = watch(await gitCommonDir(cwd), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(publish, WATCH_DEBOUNCE_MS);
    });
    if (closed) watcher.close();
  } catch (error) {
    send("failure", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error("Request body too large");
  }
  return JSON.parse(body);
}

export interface WebServerOptions {
  /** Directory where git commands run, usually the first workspace folder. */
  cwd(): string | undefined;
  /** Opens a worktree directory in VS Code. */
  open(path: string): Promise<void>;
}

/**
 * Only the page served by this server may change things: other sites cannot send a
 * JSON body cross-origin without a CORS preflight we never allow, and the host check
 * blocks DNS rebinding.
 */
function isSameOriginJson(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  return (
    /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) &&
    req.headers.origin === `http://${host}` &&
    !!req.headers["content-type"]?.startsWith("application/json")
  );
}

/** Serves the static files in `root` and the `/api` routes on a random port bound to localhost. */
export async function startWebServer(root: string, options: WebServerOptions): Promise<WebServer> {
  const server: Server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);

    if (pathname === "/api/worktrees/events") {
      if (req.method !== "GET") {
        res.writeHead(405).end();
        return;
      }
      await streamWorktrees(req, res, options.cwd());
      return;
    }

    if (pathname === "/api/settings") {
      const cwd = options.cwd();
      const sendJson = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": contentTypes[".json"], "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
      };
      if (!cwd) {
        sendJson(404, { error: "No hay una carpeta abierta en VS Code." });
        return;
      }
      try {
        if (req.method === "PUT") {
          if (!isSameOriginJson(req)) {
            sendJson(403, { error: "Forbidden" });
            return;
          }
          const input = (await readJson(req)) as { baseBranch?: unknown; worktreesDir?: unknown; compact?: unknown };
          if (typeof input.baseBranch === "string") await setBaseBranch(cwd, input.baseBranch);
          if (typeof input.worktreesDir === "string") await setWorktreesDir(cwd, input.worktreesDir);
          if (typeof input.compact === "boolean") await setCompact(cwd, input.compact);
        } else if (req.method !== "GET") {
          sendJson(405, { error: "Method not allowed" });
          return;
        }
        sendJson(200, {
          baseBranch: await getBaseBranch(cwd),
          worktreesDir: await getWorktreesDir(cwd),
          compact: await getCompact(cwd),
          branches: await listBranches(cwd),
        });
      } catch (error) {
        sendJson(400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (pathname === "/api/worktrees" || pathname === "/api/worktrees/open" || pathname === "/api/worktrees/description") {
      const cwd = options.cwd();
      const sendJson = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": contentTypes[".json"], "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
      };
      if (!cwd) {
        sendJson(404, { error: "No hay una carpeta abierta en VS Code." });
        return;
      }
      try {
        if ((req.method === "POST" || req.method === "PUT") && !isSameOriginJson(req)) {
          sendJson(403, { error: "Forbidden" });
          return;
        }
        if (pathname === "/api/worktrees/open") {
          if (req.method !== "POST") {
            sendJson(405, { error: "Method not allowed" });
            return;
          }
          const { path } = (await readJson(req)) as { path?: unknown };
          // Only open directories git reports as worktrees of this repository.
          const worktree = (await listWorktrees(cwd)).find((w) => w.path === path);
          if (!worktree) {
            sendJson(404, { error: "No existe ese worktree." });
            return;
          }
          await options.open(worktree.path);
          sendJson(200, { path: worktree.path });
          return;
        }
        if (pathname === "/api/worktrees/description") {
          if (req.method !== "PUT") {
            sendJson(405, { error: "Method not allowed" });
            return;
          }
          const { path, description } = (await readJson(req)) as { path?: unknown; description?: unknown };
          if (typeof path !== "string" || typeof description !== "string") {
            sendJson(400, { error: "Datos no válidos." });
            return;
          }
          try {
            await setWorktreeDescription(cwd, path, description);
          } catch (error) {
            sendJson(400, { error: error instanceof Error ? error.message : String(error) });
            return;
          }
          sendJson(200, { cwd, home: homedir(), compact: await getCompact(cwd), worktrees: await listWorktrees(cwd) });
          return;
        }
        if (req.method === "POST") {
          const input = (await readJson(req)) as { branch?: unknown; base?: unknown; path?: unknown };
          const asString = (value: unknown) => (typeof value === "string" ? value : undefined);
          const path = await createWorktree(cwd, {
            branch: asString(input.branch) ?? "",
            base: asString(input.base),
            path: asString(input.path),
          });
          sendJson(201, { cwd, home: homedir(), compact: await getCompact(cwd), path, worktrees: await listWorktrees(cwd) });
          return;
        }
        sendJson(200, { cwd, home: homedir(), compact: await getCompact(cwd), worktrees: await listWorktrees(cwd) });
      } catch (error) {
        sendJson(500, { cwd, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const relative = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    const file = normalize(join(root, relative));

    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }

    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
