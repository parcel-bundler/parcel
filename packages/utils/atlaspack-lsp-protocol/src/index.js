// @flow
const {
  NotificationType,
  NotificationType0,
  NotificationType2,
  RequestType,
} = require('vscode-jsonrpc/node');

// -------------------------------- Typescript-specific definitions

/**
 * @typedef {import("vscode-languageserver")} lsp
 *
 * @typedef PublishDiagnostic
 * @prop {import('vscode-languageserver').DocumentUri} uri
 * @prop {Array<import('vscode-languageserver').Diagnostics>} diagnostics
 */

// -------------------------------- Flow-specific defintions

/*::
export type PublishDiagnostic = {|
  uri: DocumentUri,
  diagnostics: Array<Diagnostic>,
|};

import type {Diagnostic, DocumentUri} from 'vscode-languageserver';
*/

// --------------------------------

/**
 * @type {RequestType<DocumentUri, Array<DocumentUri> | null, void>}
 */
// Request: LSP Server -> Reporter
export const RequestImporters /*: RequestType<DocumentUri, Array<DocumentUri> | null, void> */ =
  new RequestType('atlaspack/request-importers');

/**
 * @type {RequestType<DocumentUri, Array<Diagnostic> | undefined, void>}
 */
// Request: LSP Server -> Reporter
export const RequestDocumentDiagnostics /*: RequestType<DocumentUri, Array<Diagnostic> | void, void> */ =
  new RequestType('atlaspack/request-document-diagnostics');

/**
 * @type {NotificationType<Array<PublishDiagnostic>>}
 */
// Notification: Reporter -> LSP Server
export const NotificationWorkspaceDiagnostics /*: NotificationType<Array<PublishDiagnostic>> */ =
  new NotificationType('atlaspack/notification-workspace-diagnostics');

/**
 * @type {NotificationType2<'start' | 'progress' | 'end', string | void>}
 */
// Notification: Reporter -> LSP Server
export const NotificationBuildStatus /*: NotificationType2<'start' | 'progress' | 'end', string | void> */ =
  new NotificationType2('atlaspack/notification-build-status');

// --------------------------------

// Notification: LSP Server -> VSC Extension
/**
 * @type {import('vscode-languageserver').NotificationType0}
 */
export const NotificationBuild /*: mixed */ = new NotificationType0(
  'atlaspack/notification-build',
);
