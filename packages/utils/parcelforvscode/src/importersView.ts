import * as vscode from 'vscode';

import {LanguageClient, DocumentUri} from 'vscode-languageclient/node';
import {
  NotificationBuild,
  NotificationCodeActions,
  RequestCodeActions,
  RequestImporters,
} from '@parcel/lsp-protocol';

const COMMAND = 'code-actions-sample.command';

export class ParcelCodeAction implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): vscode.CodeAction[] {
    // for each diagnostic entry that has the matching `code`, create a code action command
    //debugger;
    return context.diagnostics
      .filter(diagnostic => diagnostic.relatedInformation?.length)
      .map(diagnostic =>
        diagnostic.relatedInformation?.map(hint =>
          this.createCommandCodeAction(hint, diagnostic),
        ),
      );
  }

  private createCommandCodeAction(
    hint: vscode.DiagnosticRelatedInformation,
    diagnostic: vscode.Diagnostic,
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      hint.message,
      vscode.CodeActionKind.QuickFix,
    );
    action.title = hint.message;
    action.command = {
      command: COMMAND,
      title: 'Learn more about emojis',
      tooltip: 'This will open the unicode emoji page.',
    };
    action.diagnostics = [diagnostic];
    // action.isPreferred = true;
    //debugger;
    return action;
  }
}

export function addCodeActions(
  context: vscode.ExtensionContext,
  client: LanguageClient,
) {
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      {scheme: 'file'},
      new ParcelCodeAction(),
      {
        providedCodeActionKinds: ParcelCodeAction.providedCodeActionKinds,
      },
    ),
  );
}

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
