// @flow
import {
  NotificationType,
  NotificationType2,
  RequestType,
} from 'vscode-jsonrpc/node';

import type {
  Diagnostic,
  DocumentUri,
  ODiagnosticTag,
  ODiagnosticSeverity,
} from 'vscode-languageserver';

// Copied over from vscode-languageserver to prevent the runtime dependency

export const DiagnosticTag = {
  /**
   * Unused or unnecessary code.
   *
   * Clients are allowed to render diagnostics with this tag faded out instead of having
   * an error squiggle.
   */
  // $FlowFixMe
  Unnecessary: (1: ODiagnosticTag),
  /**
   * Deprecated or obsolete code.
   *
   * Clients are allowed to rendered diagnostics with this tag strike through.
   */
  // $FlowFixMe
  Deprecated: (2: ODiagnosticTag),
};
export const DiagnosticSeverity = {
  /**
   * Reports an error.
   */
  // $FlowFixMe
  Error: (1: ODiagnosticSeverity),
  /**
   * Reports a warning.
   */
  // $FlowFixMe
  Warning: (2: ODiagnosticSeverity),
  /**
   * Reports an information.
   */
  // $FlowFixMe
  Information: (3: ODiagnosticSeverity),
  /**
   * Reports a hint.
   */
  // $FlowFixMe
  Hint: (4: ODiagnosticSeverity),
};

// --------------------------------
// Keep in sync with packages/utils/parcel-lsp/src/protocol.ts!

export type PublishDiagnostic = {|
  uri: DocumentUri,
  diagnostics: Array<Diagnostic>,
|};

// Request: Client -> Server
export const RequestImporters: RequestType<
  DocumentUri,
  Array<DocumentUri> | null,
  void,
> = new RequestType('RequestImporters');

// Request: Client -> Server
export const RequestDocumentDiagnostics: RequestType<
  DocumentUri,
  Array<Diagnostic> | void,
  void,
> = new RequestType('RequestDocumentDiagnostics');

// Notification: Server -> Client
export const NotificationWorkspaceDiagnostics: NotificationType<
  Array<PublishDiagnostic>,
> = new NotificationType('NotificationWorkspaceDiagnostics');

// Notification: Server -> Client
export const NotificationBuildStatus: NotificationType2<
  'start' | 'progress' | 'end',
  string | void,
> = new NotificationType2('NotificationBuildStatus');
