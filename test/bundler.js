const assert = require('assert');
const {bundler, nextBundle} = require('./utils');

describe('bundler', function() {
  it('should bundle once before exporting middleware', async function() {
    let b = bundler(__dirname + '/integration/bundler-middleware/index.js');
    b.middleware();

    await nextBundle(b);
    assert(b.mainAsset);
  });
});
