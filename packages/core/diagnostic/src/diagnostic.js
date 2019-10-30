// @flow
import type {FilePath} from '@parcel/types';

export type DiagnosticHighlightLocation = {|
  // These positions are 1-based
  line: number,
  column: number
|};

export type DiagnosticSeverity = 'error' | 'warn' | 'info';

export type DiagnosticCodeHighlight = {|
  // start and end are included in the highlighted region
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
  filePath?: FilePath,
  language?: string,

  // Codeframe data
  codeFrame?: DiagnosticCodeFrame,

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
  if (input instanceof ThrowableDiagnostic) {
    diagnostic = {...input.diagnostic};
  } else if (input instanceof Error) {
    diagnostic = errorToDiagnostic(input);
  }

  return diagnostic;
}

export function errorToDiagnostic(error: PrintableError | string): Diagnostic {
  let codeFrame: DiagnosticCodeFrame | void = undefined;

  if (typeof error === 'string') {
    return {
      origin: 'Error',
      message: error,
      codeFrame
    };
  }

  if (error.loc && error.source) {
    codeFrame = {
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
    filePath: error.fileName,
    stack: error.highlightedCodeFrame || error.codeFrame || error.stack,
    codeFrame
  };
}

type ThrowableDiagnosticOpts = {
  diagnostic: Diagnostic,
  ...
};

export default class ThrowableDiagnostic extends Error {
  diagnostic: Diagnostic;
  stack: string;

  constructor(opts: ThrowableDiagnosticOpts) {
    // Make it kinda compatible with default Node Error
    super(opts.diagnostic.message);
    this.stack = opts.diagnostic.stack || super.stack;

    this.diagnostic = opts.diagnostic;
  }
}
