module.exports = function(err, opts = {}) {
  let message = typeof err === 'string' ? err : err.message;
  if (!message) {
    message = 'Unknown error';
  }

  if (err.fileName) {
    let fileName = err.fileName;
    if (err.loc) {
      fileName += `:${err.loc.line}:${err.loc.column}`;
    }

    message = `${fileName}: ${message}`;
  }

  let stack;
  if (err.codeFrame) {
    stack = (opts.color && err.highlightedCodeFrame) || err.codeFrame;
  } else if (err.stack) {
    stack = err.stack.slice(err.stack.indexOf('\n') + 1);
  }

  return {message, stack};
};
