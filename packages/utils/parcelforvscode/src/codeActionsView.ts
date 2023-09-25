import * as vscode from 'vscode';

import {LanguageClient} from 'vscode-languageclient/node';

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
    return context.diagnostics
      .filter(
        diagnostic =>
          // TODO: find a better way to filter Parcel diagnostics?
          diagnostic.source?.startsWith('@parcel') &&
          diagnostic.relatedInformation?.length,
      )
      .flatMap((diagnostic: vscode.Diagnostic) =>
        diagnostic.relatedInformation?.map(diagnosticInfo =>
          this.createCommandCodeAction(diagnosticInfo, diagnostic),
        ),
      );
  }

  private createCommandCodeAction(
    diagnosticInfo: vscode.DiagnosticRelatedInformation,
    diagnostic: vscode.Diagnostic,
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `${diagnostic.code}`,
      vscode.CodeActionKind.QuickFix,
    );
    action.edit = new vscode.WorkspaceEdit();
    action.edit.insert(
      diagnosticInfo.location.uri,
      new vscode.Position(
        diagnosticInfo.location.range.start.line,
        diagnosticInfo.location.range.start.character,
      ),
      diagnosticInfo.message,
    );
    // action.edit.replace(
    //   diagnosticInfo.location.uri,
    //   diagnosticInfo.location.range,
    //   diagnosticInfo.message,
    // );

    let diagnostics = action.diagnostics;
    diagnostics?.push(diagnostic);
    action.diagnostics = diagnostics;
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
