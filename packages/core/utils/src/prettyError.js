// @flow strict-local

export type PrintableError =
  | string
  | (Error & {
      codeFrame?: string,
      highlightedCodeFrame?: string,
      loc?: {|
        column: number,
        line: number
      |},
      ...
    });

export type PrettyErrorOpts = {color?: boolean, ...};

export type PrettyError = {|
  message: string,
  stack?: string
|};

export default function prettyError(
  err: PrintableError,
  opts: PrettyErrorOpts = {}
): PrettyError {
  if (typeof err === 'string') {
    return {
      message: err
    };
  }

  let message = err.message;
  if (!message) {
    message = 'Unknown error';
  }

  if (err.fileName != null) {
    let fileName = err.fileName;
    if (err.loc) {
      fileName += `:${err.loc.line}:${err.loc.column}`;
    }

    message = `${fileName}: ${message}`;
  }

  let stack;
  if (err.codeFrame != null && err.codeFrame !== '') {
    stack = (opts.color === true && err.highlightedCodeFrame) || err.codeFrame;
  } else if (err.stack) {
    stack = err.stack.slice(err.stack.indexOf('\n') + 1);
  }

  return {message, stack};
}
