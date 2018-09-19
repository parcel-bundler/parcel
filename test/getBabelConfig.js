const assert = require('assert');
const fs = require('../src/utils/fs');
const {bundler} = require('./utils');
const getBabelConfig = require('../src/transforms/babel/config');

function getPluginName(p) {
  return Array.isArray(p) ? p[0] : p;
}

function normalizePlugins(plugins) {
  return plugins.reduce((acc, p) => {
    let name = getPluginName(p);
    if (typeof name === 'string') {
      acc.push(name);
    }
    return acc;
  }, []);
}

function getPlugins(babelConfig) {
  let plugins = [];

  if (babelConfig[6]) {
    plugins = plugins.concat(normalizePlugins(babelConfig[6].config.plugins));
  }

  if (babelConfig[7]) {
    plugins = plugins.concat(normalizePlugins(babelConfig[7].config.plugins));
  }

  return plugins;
}

describe('getBabelConfig', function() {
  it('should handle duplicate plugins from preset env for babel v7', async function() {
    let originalPkg = await fs.readFile(
      __dirname + '/integration/babel-7-duplicate-env-plugin/package.json'
    );
    let b = await bundler(
      __dirname + '/integration/babel-7-duplicate-env-plugin/index.js'
    );

    await b.bundle();

    let firstAsset = Array.from(b.entryAssets)[0];
    firstAsset.contents = '';
    const babelConfig = await getBabelConfig(firstAsset);

    assert.deepEqual(getPlugins(babelConfig), []);

    await fs.writeFile(
      __dirname + '/integration/babel-7-duplicate-env-plugin/package.json',
      originalPkg
    );
  });
});
