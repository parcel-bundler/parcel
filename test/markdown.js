const assert = require('assert');
const {bundle, run} = require('./utils');

describe('markdown', function() {
  it('should return markdown content as string', async function() {
    const app = await bundle(__dirname + '/integration/markdown/index.js');
    const output = run(app);

    assert.equal(output(), '# Usage\n> Hi');
  });
});
