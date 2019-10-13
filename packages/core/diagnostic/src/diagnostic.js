// @flow

export type DiagnosticHighlightLocation = {|
  line: number,
  column: number
|};

export type DiagnosticSeverity = 'error' | 'warn' | 'info';

export type DiagnosticCodeHighlight = {|
  start: DiagnosticHighlightLocation,
  end: DiagnosticHighlightLocation
|};

// A Diagnostic is a style agnostic way of emitting errors, warnings and info
// The reporter's are responsible for rendering the message, codeframes, hints, ...
export type Diagnostic = {|
  message: string,
  severity: DiagnosticSeverity,
  origin: string, // Name of plugin or file that threw this error

  // Asset metadata
  filename?: string,
  language?: string,

  // Codeframe data
  code?: string,
  codeHighlights?: DiagnosticCodeHighlight | Array<DiagnosticCodeHighlight>,

  // Hints to resolve issues faster
  hints?: string | Array<string>,

  // !Should only be used if there's no way to supply code and codeHighlight...
  stack?: string
|};

export default class ParcelDiagnostic {
  message: string;
  severity: DiagnosticSeverity;
  origin: string;
  filename: ?string;
  language: ?string;
  code: ?string;
  codeHighlights: ?(DiagnosticCodeHighlight | Array<DiagnosticCodeHighlight>);
  hints: ?(string | Array<string>);
  stack: ?string;

  constructor(input: Diagnostic) {
    this.message = input.message;
    this.severity = input.severity;
    this.origin = input.origin;
    this.filename = input.filename;
    this.language = input.language;
    this.code = input.code;
    this.codeHighlights = input.codeHighlights;
    this.hints = input.hints;
    this.stack = input.stack;
  }
}
