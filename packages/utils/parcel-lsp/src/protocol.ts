// @flow
import {
  NotificationType,
  NotificationType0,
  NotificationType2,
  RequestType,
} from 'vscode-jsonrpc/node';

import type {
  DefinitionLink,
  Diagnostic,
  DocumentUri,
  TextDocumentPositionParams,
} from 'vscode-languageserver';

// Notification: LSP Server -> Extension Client
export const NotificationBuild: NotificationType0 = new NotificationType0(
  'NotificationBuild',
);

// --------------------------------
// Keep in sync with packages/reporters/lsp-reporter/src/protocol.js!

export type PublishDiagnostic = {
  uri: DocumentUri;
  diagnostics: Array<Diagnostic>;
};

// Request: Client -> Server
export const RequestDefinition: RequestType<
  TextDocumentPositionParams,
  Array<DefinitionLink> | undefined,
  void
> = new RequestType('RequestDefinition');

// Request: Client -> Server
export const RequestImporters: RequestType<
  DocumentUri,
  Array<DocumentUri> | null,
  void
> = new RequestType('RequestImporters');

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
