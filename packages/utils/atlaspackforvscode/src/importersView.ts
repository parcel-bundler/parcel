import * as vscode from 'vscode';

import {LanguageClient, DocumentUri} from 'vscode-languageclient/node';
import {NotificationBuild, RequestImporters} from '@atlaspack/lsp-protocol';

export function addImportersView(
  context: vscode.ExtensionContext,
  client: LanguageClient,
) {
  let importersTreeProvider = new ImportersTreeProvider(client);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'importersView',
      importersTreeProvider,
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('importersView.focus', () => {
      let activeEditor = vscode.window.activeTextEditor?.document.uri;
      if (activeEditor) {
        importersTreeProvider.setRoot(activeEditor.toString());
      }
    }),
  );

  context.subscriptions.push(
    // Clear after builds
    client.onNotification(NotificationBuild, () => {
      importersTreeProvider.setRoot(undefined);
    }),
  );
}

export class ImportersTreeProvider implements vscode.TreeDataProvider<string> {
  client: LanguageClient;
  cache: Map<DocumentUri, Array<DocumentUri>>;
  changeEvent: vscode.EventEmitter<string | undefined>;

  root: DocumentUri | undefined;
  constructor(client: LanguageClient) {
    this.client = client;
    this.changeEvent = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changeEvent.event;
    this.cache = new Map();
  }

  setRoot(r: DocumentUri | undefined) {
    this.root = r;
    this.changeEvent.fire(undefined);
    this.cache.clear();
  }

  onDidChangeTreeData:
    | vscode.Event<string | void | string[] | null | undefined>
    | undefined;

  async getTreeItem(element: string) {
    let uri = vscode.Uri.parse(element);
    let children = await this.getChildren(element);
    return {
      resourceUri: uri,
      collapsibleState:
        children.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      command: {
        title: 'open',
        command: 'vscode.open',
        arguments: [uri],
      },
      iconPath: vscode.ThemeIcon.File,
    };
  }

  async getChildren(element?: string | undefined) {
    if (element) {
      return await this.getAsset(element);
    } else {
      return this.root ? [this.root.toString()] : [];
    }
  }

  private async getAsset(uri: DocumentUri) {
    let cached = this.cache.get(uri);
    if (cached) {
      return cached;
    }

    let result = await this.client.sendRequest(RequestImporters, uri);
    this.cache.set(uri, result ?? []);
    return result ?? [];
  }
}
