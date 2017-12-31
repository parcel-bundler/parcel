const assert = require('assert');
const {bundler} = require('./utils');

describe('bundler', function() {
  it('should bundle once before exporting middleware', function(done) {
    let b = bundler(__dirname + '/integration/commonjs/index.js');
    b.middleware();

    setTimeout(() => {
      assert(b.mainAsset);
      done();
    }, 300);
  });
});
