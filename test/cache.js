const assert = require('assert');
const fs = require('fs');
const {bundler} = require('./utils');

describe('cache', function() {
  it('should cache assets', async function() {
    let b = bundler(__dirname + '/integration/cache/index.html', {cache: true});
    await b.bundle();
    let cachedFile = fs.readdirSync(
      __dirname + '/integration/cache/.cache/'
    )[0];
    let cacheContent = fs.readFileSync(
      __dirname + '/integration/cache/.cache/' + cachedFile,
      'utf8'
    );
    assert(Object.keys(cacheContent), 'dependencies,generated,hash,cacheData');
  });
});
