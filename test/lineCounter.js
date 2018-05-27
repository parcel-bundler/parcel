const fs = require('fs');
const assert = require('assert');
const lineCounter = require('../src/utils/lineCounter');

describe('line counter', () => {
  it('counts number of lines of a string', () => {
    const input = ` line 1
      line 2
      line 3`;

    assert(lineCounter(input) === 3);
  });

  it('counts number of lines of a file from disk', () => {
    const input = fs.readFileSync('./test/lineCounter.js').toString();
    assert(lineCounter(input) === 19);
  });
});
