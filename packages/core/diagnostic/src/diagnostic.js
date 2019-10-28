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
  origin: string, // Name of plugin or file that threw this error

  // Asset metadata
  filename?: string,
  language?: string,

  // Codeframe data
  codeframe?: DiagnosticCodeFrame,

  // Stacktrace for error, not really needed if there's a codeframe...
  stack?: string,

  // Hints to resolve issues faster
  hints?: Array<string>
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

export function anyToDiagnostic(
  input: Diagnostic | PrintableError | ThrowableDiagnostic | string
): Diagnostic {
  // $FlowFixMe
  let diagnostic: Diagnostic = input;
  if (input instanceof Error) {
    diagnostic = errorToDiagnostic(input);
  } else if (input instanceof ThrowableDiagnostic) {
    diagnostic = input.toObject();
  }

  return diagnostic;
}

export function errorToDiagnostic(error: PrintableError | string): Diagnostic {
  let codeframe: DiagnosticCodeFrame | void = undefined;

  if (typeof error === 'string') {
    return {
      origin: 'Error',
      message: error,
      codeframe
    };
  }

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

export default class ThrowableDiagnostic extends Error {
  #diagnostic: Diagnostic;
  stack: string;

  constructor(opts: ThrowableDiagnosticOpts) {
    // Make it kinda compatible with default Node Error
    super(opts.diagnostic.message);
    this.stack = opts.diagnostic.stack || super.stack;

    this.#diagnostic = opts.diagnostic;
  }

  toObject() {
    return this.#diagnostic;
  }
}
