import * as vscode from "vscode";
import { startWebServer, type WebServer } from "./server";

class WorktreeViewProvider implements vscode.WebviewViewProvider {
  private server?: Promise<WebServer>;

  constructor(private readonly extensionUri: vscode.Uri) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    view.webview.options = { enableScripts: true };

    this.server ??= startWebServer(vscode.Uri.joinPath(this.extensionUri, "web").fsPath, {
      cwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });
    const { url } = await this.server;
    const src = (await vscode.env.asExternalUri(vscode.Uri.parse(url))).toString(true);

    view.webview.html = renderFrame(view.webview, src);
  }

  async dispose(): Promise<void> {
    await (await this.server)?.close();
  }
}

function renderFrame(webview: vscode.Webview, src: string): string {
  const origin = new URL(src).origin;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src ${webview.cspSource} 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body, iframe { margin: 0; padding: 0; width: 100%; height: 100%; border: 0; overflow: hidden; }
  </style>
</head>
<body>
  <iframe src="${src}" title="Worktree"></iframe>
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
