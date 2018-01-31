const assert = require('assert');
const fs = require('fs');
const {bundle} = require('./utils');

describe('treeshaking', function() {
  it('Shake of unrequired properties of a require', async function() {
    await bundle(__dirname + '/integration/treeshaking-requires/index.js');

    let js = fs.readFileSync(__dirname + '/dist/index.js', 'utf8');
    assert(!js.includes('exports.c'));
  });
});
