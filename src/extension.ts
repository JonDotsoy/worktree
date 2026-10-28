import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { startWebServer, type WebServer } from "./server";

class WorktreeViewProvider implements vscode.WebviewViewProvider {
  private server?: Promise<WebServer>;

  constructor(private readonly extensionUri: vscode.Uri) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    view.webview.options = { enableScripts: true };

    this.server ??= startWebServer(vscode.Uri.joinPath(this.extensionUri, "web").fsPath, {
      cwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      open: openInVSCode,
    });
    const { url } = await this.server;
    const src = (await vscode.env.asExternalUri(vscode.Uri.parse(url))).toString(true);

    view.webview.html = renderFrame(view.webview, src);
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

function renderFrame(webview: vscode.Webview, src: string): string {
  const origin = new URL(src).origin;
  const nonce = randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body, iframe { margin: 0; padding: 0; width: 100%; height: 100%; border: 0; overflow: hidden; }
  </style>
</head>
<body>
  <iframe src="${src}" title="Worktree"></iframe>
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
  const provider = new WorktreeViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("worktree.list", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    { dispose: () => void provider.dispose() },
  );
}

export function deactivate() {}
