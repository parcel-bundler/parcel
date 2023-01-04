// @flow
import {
  NotificationType,
  NotificationType0,
  NotificationType2,
  RequestType,
} from 'vscode-jsonrpc/node';

import type {Diagnostic, DocumentUri} from 'vscode-languageserver';

// Notification: LSP Server -> VSC Extension
export const NotificationBuild: NotificationType0 = new NotificationType0(
  'NotificationBuild',
);

// --------------------------------
// Keep in sync with packages/reporters/lsp-reporter/src/protocol.js!

export type PublishDiagnostic = {
  uri: DocumentUri;
  diagnostics: Array<Diagnostic>;
};

// Request: LSP Server -> Reporter
export const RequestImporters: RequestType<
  DocumentUri,
  Array<DocumentUri> | null,
  void
> = new RequestType('RequestImporters');

// Request: LSP Server -> Reporter
export const RequestDocumentDiagnostics: RequestType<
  DocumentUri,
  Array<Diagnostic> | undefined,
  void
> = new RequestType('RequestDocumentDiagnostics');

// Notification: Reporter -> LSP Server
export const NotificationWorkspaceDiagnostics: NotificationType<
  Array<PublishDiagnostic>
> = new NotificationType('NotificationWorkspaceDiagnostics');

// Notification: Reporter -> LSP Server
export const NotificationBuildStatus: NotificationType2<
  'start' | 'progress' | 'end',
  string | void
> = new NotificationType2('NotificationBuildStatus');
