const assert = require('assert');
const prettyError = require('../src/prettyError');

const message = 'Error Message!';
const fileName = 'Test.js';
const codeFrame = '<code>frame</code>';
const stack =
  'Error: Uh-oh. Something went wrong. Line 88. \n Oh no. Something else went wrong. Line 77 \n';

describe('prettyError', () => {
  it('should handle passing error as string', () => {
    const err = prettyError(message);

    assert.equal(err.message, message);
    assert.equal(err.stack, undefined);
  });

  it('should handle passing error as object', () => {
    const err = prettyError({message});

    assert.equal(err.message, message);
    assert.equal(err.stack, undefined);
  });

  it('should handle unknown input', () => {
    const err = prettyError(Number.NaN);

    assert(err.message.length); // non-empty error message
    assert.equal(err.stack, undefined);
  });

  it('should prepend fileName', () => {
    const err = prettyError({
      message,
      fileName
    });

    assert(err.message.startsWith(fileName));
    assert.equal(err.stack, undefined);
  });

  it('should prepend line and column location', () => {
    const err = prettyError({
      message,
      fileName,
      loc: {
        line: 1,
        column: 10
      }
    });

    assert(err.message.startsWith(`${fileName}:1:10`));
    assert.equal(err.stack, undefined);
  });

  it('should support providing a codeFrame as stack', () => {
    const err = prettyError({
      message,
      stack,
      codeFrame: codeFrame
    });

    assert.equal(err.message, message);
    assert.equal(err.stack, codeFrame);
  });

  it('should support highlightedCodeFrame when opts.color is true', () => {
    let err = prettyError(
      {
        message,
        stack,
        codeFrame: '<not>a code frame</not>',
        highlightedCodeFrame: codeFrame
      },
      {color: true}
    );

    assert.equal(err.message, message);
    assert.equal(err.stack, codeFrame);

    err = prettyError(
      {
        message,
        stack,
        codeFrame: codeFrame,
        highlightedCodeFrame: '<not>a code frame</not>'
      },
      {color: false}
    );

    assert.equal(err.message, message);
    assert.equal(err.stack, codeFrame);
  });

  it('should support stack', () => {
    const err = prettyError({
      message,
      stack
    });

    assert.equal(err.message, message);
    assert(err.stack.includes('Line'));
  });
});
