// @flow
import {
  NotificationType,
  NotificationType2,
  RequestType,
} from 'vscode-jsonrpc/node';

opaque type ODiagnosticTag = 1 | 2 | 3 | 4;
opaque type ODiagnosticSeverity = 1 | 2 | 3 | 4;

export const DiagnosticTag = {
  /**
   * Unused or unnecessary code.
   *
   * Clients are allowed to render diagnostics with this tag faded out instead of having
   * an error squiggle.
   */
  Unnecessary: (1: ODiagnosticTag),
  /**
   * Deprecated or obsolete code.
   *
   * Clients are allowed to rendered diagnostics with this tag strike through.
   */
  Deprecated: (2: ODiagnosticTag),
};

export const DiagnosticSeverity = {
  /**
   * Reports an error.
   */
  Error: (1: ODiagnosticSeverity),
  /**
   * Reports a warning.
   */
  Warning: (2: ODiagnosticSeverity),
  /**
   * Reports an information.
   */
  Information: (3: ODiagnosticSeverity),
  /**
   * Reports a hint.
   */
  Hint: (4: ODiagnosticSeverity),
};

export type DocumentUri = string;
export type Position = {|line: number, character: number|};
export type Range = {|start: Position, end: Position|};
export type CodeDescription = {|href: string|};
export type Location = {|uri: string, range: Range|};
export type DiagnosticRelatedInformation = {|
  location: Location,
  message: string,
|};
export type Diagnostic = {|
  range: Range,
  severity?: ODiagnosticSeverity,
  code?: number | string,
  codeDescription?: CodeDescription,
  source?: string,
  message: string,
  tags?: ODiagnosticTag[],
  relatedInformation?: DiagnosticRelatedInformation[],
  data?: mixed,
|};

// --------------------------------
// Keep in sync with packages/utils/parcel-lsp/src/protocol.ts!

export type PublishDiagnostic = {|
  uri: DocumentUri,
  diagnostics: Array<Diagnostic>,
|};

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
