const assert = require('assert');
const fs = require('../src/utils/fs');
const path = require('path');
const {bundler} = require('./utils');

describe('cascading plugins', function() {

  it('should generated the output correctly', async function() {
    const src = path.resolve(__dirname, 'integration/cascading-plugins//source.htl');
    const b = bundler(src, { target: 'node'});
    b.addAssetType('htl', require.resolve('./integration/cascading-plugins/HTLPreAsset.js'));
    b.addAssetType('htl-preprocessed', require.resolve('./integration/cascading-plugins/HTLAsset.js'));
    await b.bundle();

    let generated = await fs.readFile(__dirname + '/dist/source.js', 'utf8');
    let expected = await fs.readFile(path.resolve(__dirname, 'integration/cascading-plugins//source-expected.js'), 'utf8');
    assert.equal(generated, expected)
  });
});
