// @flow
import {
  NotificationType,
  NotificationType2,
  RequestType,
} from 'vscode-jsonrpc/node';

export type DocumentUri = string;
export type DiagnosticSeverity = 1 | 2 | 3 | 4; // error | warning | info | hint
export type DiagnosticTag = 1 | 2; // Unnecessary | Deprecated
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
  severity?: DiagnosticSeverity,
  code?: number | string,
  codeDescription?: CodeDescription,
  source?: string,
  message: string,
  tags?: DiagnosticTag[],
  relatedInformation?: DiagnosticRelatedInformation[],
  data?: mixed,
|};

// --------------------------------

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
