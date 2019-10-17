// @flow

export type DiagnosticHighlightLocation = {|
  line: number,
  column: number
|};

export type DiagnosticSeverity = 'error' | 'warn' | 'info';

export type DiagnosticCodeHighlight = {|
  start: DiagnosticHighlightLocation,
  end: DiagnosticHighlightLocation,
  message?: string
|};

export type DiagnosticCodeFrame = {|
  code: string,
  codeHighlights: DiagnosticCodeHighlight | Array<DiagnosticCodeHighlight>
|};

// A Diagnostic is a style agnostic way of emitting errors, warnings and info
// The reporter's are responsible for rendering the message, codeframes, hints, ...
export type Diagnostic = {|
  message: string,
  //? severity: DiagnosticSeverity, // Might add this back later...
  origin: string, // Name of plugin or file that threw this error

  // Asset metadata
  filename?: string,
  language?: string,

  // Codeframe data
  codeframe?: DiagnosticCodeFrame,

  // Hints to resolve issues faster
  hints?: Array<string>,

  //! Should only be used if there's no way to supply code and codeHighlight...
  stack?: string
|};

// This type should represent all error formats Parcel can encounter...
export type PrintableError = Error & {
  fileName?: string,
  codeFrame?: string,
  highlightedCodeFrame?: string,
  loc?: {
    column: number,
    line: number,
    ...
  },
  source?: string,
  ...
};

export function errorToDiagnostic(error: PrintableError): Diagnostic {
  let codeframe: DiagnosticCodeFrame | void = undefined;

  if (error.loc && error.source) {
    codeframe = {
      code: error.source,
      codeHighlights: {
        start: {
          line: error.loc.line,
          column: error.loc.column
        },
        end: {
          line: error.loc.line,
          column: error.loc.column
        }
      }
    };
  }

  return {
    origin: 'Error',
    message: error.message,
    filename: error.fileName,
    stack: error.highlightedCodeFrame || error.codeFrame || error.stack,
    codeframe
  };
}

type ThrowableDiagnosticOpts = {
  diagnostic: Diagnostic,
  ...
};

export default class ThrowableDiagnostic {
  #diagnostic: Diagnostic;

  constructor(opts: ThrowableDiagnosticOpts) {
    this.#diagnostic = opts.diagnostic;
  }

  toObject() {
    return this.#diagnostic;
  }
}
