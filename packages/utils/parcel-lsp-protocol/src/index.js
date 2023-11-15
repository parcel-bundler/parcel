// @flow
const {
  NotificationType,
  NotificationType0,
  NotificationType2,
  RequestType,
  RequestType3,
} = require('vscode-jsonrpc/node');

// -------------------------------- Typescript-specific definitions

/**
 * @typedef {import("vscode-languageserver")} lsp
 * @typedef {import("vscode-languageserver").LocationLink} LocationLink
 * @typedef {import("vscode-languageserver").Definition} Definition
 *
 * @typedef PublishDiagnostic
 * @prop {import('vscode-languageserver').DocumentUri} uri
 * @prop {Array<import('vscode-languageserver').Diagnostics>} diagnostics
 */

// -------------------------------- Flow-specific defintions

/*::
import type {Diagnostic, DocumentUri, Position, Definition, LocationLink} from 'vscode-languageserver';

export type PublishDiagnostic = {|
  uri: DocumentUri,
  diagnostics: Array<Diagnostic>,
|};

*/

// --------------------------------

/**
 * @type {RequestType<DocumentUri, Array<DocumentUri> | null, void>}
 */
// Request: LSP Server -> Reporter
export const RequestImporters /*: RequestType<DocumentUri, Array<DocumentUri> | null, void> */ =
  new RequestType('parcel/request-importers');

/**
 * @type {RequestType<DocumentUri, Array<Diagnostic> | undefined, void>}
 */
// Request: LSP Server -> Reporter
export const RequestDocumentDiagnostics /*: RequestType<DocumentUri, Array<Diagnostic> | void, void> */ =
  new RequestType('parcel/request-document-diagnostics');

/**
 * @type {RequestType3<DocumentUri, string, Position, Definition | LocationLink[] | null, void>}
 */
// Request: LSP Server -> Reporter
export const RequestDefinition /*: RequestType3<DocumentUri, string, Position, Definition | LocationLink[] | null, void> */ =
  new RequestType3('parcel/request-definition');

/**
 * @type {NotificationType<Array<PublishDiagnostic>>}
 */
// Notification: Reporter -> LSP Server
export const NotificationWorkspaceDiagnostics /*: NotificationType<Array<PublishDiagnostic>> */ =
  new NotificationType('parcel/notification-workspace-diagnostics');

/**
 * @type {NotificationType2<'start' | 'progress' | 'end', string | void>}
 */
// Notification: Reporter -> LSP Server
export const NotificationBuildStatus /*: NotificationType2<'start' | 'progress' | 'end', string | void> */ =
  new NotificationType2('parcel/notification-build-status');

// --------------------------------

// Notification: LSP Server -> VSC Extension
/**
 * @type {import('vscode-languageserver').NotificationType0}
 */
export const NotificationBuild /*: mixed */ = new NotificationType0(
  'parcel/notification-build',
);
