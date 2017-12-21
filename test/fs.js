const assert = require('assert');
const {bundle, run} = require('./utils');

describe('fs', function() {
  it('should inline a file as a string', async function() {
    let b = await bundle(__dirname + '/integration/fs/index.js');
    let output = run(b);
    assert.equal(output, 'hello');
  });

  it('should inline a file as a buffer', async function() {
    let b = await bundle(__dirname + '/integration/fs-buffer/index.js');
    let output = run(b);
    assert.equal(output.constructor.name, 'Buffer');
    assert.equal(output.length, 5);
  });

  it('should inline a file with fs require alias', async function() {
    let b = await bundle(__dirname + '/integration/fs-alias/index.js');
    let output = run(b);
    assert.equal(output, 'hello');
  });

  it('should inline a file with fs require inline', async function() {
    let b = await bundle(__dirname + '/integration/fs-inline/index.js');
    let output = run(b);
    assert.equal(output, 'hello');
  });

  it('should inline a file with fs require assignment', async function() {
    let b = await bundle(__dirname + '/integration/fs-assign/index.js');
    let output = run(b);
    assert.equal(output, 'hello');
  });

  it('should inline a file with fs require assignment alias', async function() {
    let b = await bundle(__dirname + '/integration/fs-assign-alias/index.js');
    let output = run(b);
    assert.equal(output, 'hello');
  });

  it('should inline a file with fs require destructure', async function() {
    let b = await bundle(__dirname + '/integration/fs-destructure/index.js');
    let output = run(b);
    assert.equal(output, 'hello');
  });

  it('should inline a file with fs require destructure assignment', async function() {
    let b = await bundle(
      __dirname + '/integration/fs-destructure-assign/index.js'
    );
    let output = run(b);
    assert.equal(output, 'hello');
  });
});
