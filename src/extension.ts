import * as vscode from "vscode";

class WorktreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    return [];
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("worktree.list", new WorktreeProvider()),
  );
}

export function deactivate() {}
