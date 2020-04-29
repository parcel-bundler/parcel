import assert from 'assert';
import chalk from 'chalk';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';

import {splitAnsi} from '../src/ansi-utils';

const LENGTH = 5;

describe('Split ansi', () => {
  it('Should be able to split a long string into smaller strings', () => {
    let originalString =
      chalk.cyan('This') +
      chalk.whiteBright('is a very long string') +
      chalk.green('with a couple colors');
    let lines = splitAnsi(originalString, LENGTH);

    assert.equal(lines.length, 9);
    assert(lines.join('').length > originalString.length);
    assert.equal(stripAnsi(lines.join('')), stripAnsi(originalString));
    for (let line of lines) {
      assert(stringWidth(line) <= LENGTH);
    }
  });

  it('Should also be able to handle strings that do not use any ansi', () => {
    let originalString = 'This is a regular string without any ansi';
    let lines = splitAnsi(originalString, LENGTH);

    assert.equal(lines.length, 9);
    assert.equal(lines.join(''), originalString);
    for (let line of lines) {
      assert(stringWidth(line) <= LENGTH);
    }
  });

  it('Should ignore maxWidth of less than 1', () => {
    let originalString = 'This is a regular string without any ansi';
    let lines = splitAnsi(originalString, 0);

    assert.equal(lines.length, originalString.length);
    assert.equal(lines.join(''), originalString);
    for (let line of lines) {
      assert.equal(stringWidth(line), 1);
    }
  });
});
