const fs = require('@parcel/fs');
const path = require('path');
const assert = require('assert');
const lineCounter = require('../src/utils/lineCounter');

describe('line counter', async function() {
  it('counts number of lines of a string', () => {
    const input = ` line 1
      line 2
      line 3`;

    assert(lineCounter(input) === 3);
  });

  it('counts number of lines of a file from disk', async function() {
    const input = (await fs.readFile(
      path.join(__dirname, 'lineCounter.js')
    )).toString();
    assert.equal(lineCounter(input), 22);
  });
});
