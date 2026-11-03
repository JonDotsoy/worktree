import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolveLocale } from "./i18n";
import { startWebServer, type WebServer } from "./server";

class WorktreeViewProvider implements vscode.WebviewViewProvider {
  private server?: Promise<WebServer>;
  private view?: vscode.WebviewView;
  private reloads = 0;

  constructor(private readonly extensionUri: vscode.Uri, private readonly version: string) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = { enableScripts: true };

    this.server ??= startWebServer(vscode.Uri.joinPath(this.extensionUri, "web").fsPath, {
      cwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      open: openInVSCode,
      locale: currentLocale,
      localesDir: vscode.Uri.joinPath(this.extensionUri, "locales").fsPath,
      version: this.version,
    });
    const { url } = await this.server;
    // The query only busts the cache: reloading the iframe re-reads the locale from the server.
    const src = (await vscode.env.asExternalUri(vscode.Uri.parse(`${url}?v=${this.reloads}`))).toString(true);

    view.webview.html = renderFrame(view.webview, src, currentLocale());
  }

  /** Re-renders the view, e.g. after `worktree.locale` changes. */
  async reload(): Promise<void> {
    if (!this.view) return;
    this.reloads++;
    await this.resolveWebviewView(this.view);
  }

  async dispose(): Promise<void> {
    await (await this.server)?.close();
  }
}

/** Runs `code <path>`, falling back to VS Code's own command when the CLI is not on the PATH. */
async function openInVSCode(path: string): Promise<void> {
  // Variables from the extension host would make the CLI talk to this window instead of
  // behaving like a terminal invocation.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VSCODE_") && key !== "ELECTRON_RUN_AS_NODE"),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("code", [path], { detached: true, stdio: "ignore", env });
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
      child.once("error", reject);
    });
  } catch {
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(path), { forceNewWindow: true });
  }
}

function currentLocale() {
  return resolveLocale(vscode.workspace.getConfiguration("worktree").get("locale"), vscode.env.language);
}

function renderFrame(webview: vscode.Webview, src: string, locale: string): string {
  const origin = new URL(src).origin;
  const nonce = randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body, iframe { margin: 0; padding: 0; width: 100%; height: 100%; border: 0; overflow: hidden; }
  </style>
</head>
<body>
  <iframe src="${src}" title="Worktree" allow="clipboard-read; clipboard-write"></iframe>
  <script nonce="${nonce}">
    // The iframe is served from another origin, so it does not inherit the --vscode-*
    // variables VS Code injects here. Forward them, and again on every theme change.
    const frame = document.querySelector("iframe");
    const targetOrigin = ${JSON.stringify(origin)};
    function sendTheme() {
      const style = document.documentElement.style;
      const vars = {};
      for (let i = 0; i < style.length; i++) {
        const name = style[i];
        if (name.startsWith("--vscode-")) vars[name] = style.getPropertyValue(name);
      }
      const kind = document.body.dataset.vscodeThemeKind;
      frame.contentWindow?.postMessage({ type: "vscode-theme", kind, vars }, targetOrigin);
    }
    frame.addEventListener("load", sendTheme);
    new MutationObserver(sendTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    new MutationObserver(sendTheme).observe(document.body, { attributes: true, attributeFilter: ["class", "data-vscode-theme-kind"] });
  </script>
</body>
</html>`;
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new WorktreeViewProvider(context.extensionUri, String(context.extension.packageJSON.version));
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("worktree.list", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("worktree.locale")) void provider.reload();
    }),
    { dispose: () => void provider.dispose() },
  );
}

export function deactivate() {}
