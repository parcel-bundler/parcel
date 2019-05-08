const assert = require('assert');
const sinon = require('sinon');
const path = require('path');
const logger = require('@parcel/logger');
const {bundle, run, assertBundleTree} = require('@parcel/test-utils');

describe.skip('plugins', function() {
  it('should load plugins and apply custom asset type', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/plugins/test-plugin/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'test.txt'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(output, 'hello world');
  });

  it('should load package.json from parent tree', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/plugins/test-plugin/sub-folder/index.js'
      )
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'test.txt'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(output, 'hello world');
  });

  it('log a warning if a plugin throws an exception during initialization', async function() {
    sinon.stub(logger, 'warn');

    let b = await bundle(
      path.join(__dirname, '/integration/plugins/throwing-plugin/index.js')
    );

    await run(b);

    sinon.assert.calledWith(
      logger.warn,
      sinon.match(
        'Plugin parcel-plugin-test failed to initialize: Error: Plugin error'
      )
    );

    logger.warn.restore();
  });

  it('log a warning if a parser throws an exception during initialization', async function() {
    sinon.stub(logger, 'warn');

    let b = await bundle(
      path.join(
        __dirname,
        '/integration/plugins/throwing-plugin-parser/index.js'
      )
    );

    await run(b);

    sinon.assert.calledWith(
      logger.warn,
      sinon.match(
        /Parser "test.integration.plugins.throwing-plugin-parser.node_modules.parcel-plugin-test.TextAsset\.js" failed to initialize when processing asset "test.integration.plugins.throwing-plugin-parser.test\.txt"\. Threw the following error:\nError: Parser error/
      )
    );

    logger.warn.restore();
  });
});
