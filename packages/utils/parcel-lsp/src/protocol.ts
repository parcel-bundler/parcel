// @flow
import {
  NotificationType,
  NotificationType2,
  RequestType,
} from 'vscode-jsonrpc/node';

import type {DocumentUri, Diagnostic} from 'vscode-languageserver';

// --------------------------------
// Keep in sync with packages/reporters/lsp-reporter/src/protocol.js!

export type PublishDiagnostic = {
  uri: DocumentUri;
  diagnostics: Array<Diagnostic>;
};

// Request: Client -> Server
export const RequestDocumentDiagnostics: RequestType<
  DocumentUri,
  Array<Diagnostic> | undefined,
  void
> = new RequestType('RequestDocumentDiagnostics');

// Notification: Server -> Client
export const NotificationWorkspaceDiagnostics: NotificationType<
  Array<PublishDiagnostic>
> = new NotificationType('NotificationWorkspaceDiagnostics');

// Notification: Server -> Client
export const NotificationBuildStatus: NotificationType2<
  'start' | 'progress' | 'end',
  string | void
> = new NotificationType2('NotificationBuildStatus');
