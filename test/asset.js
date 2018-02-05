const assert = require('assert');
const fs = require('fs');
const {bundle} = require('./utils');
const Asset = require('../src/Asset');

describe('Asset', () => {
  it('should support overriding the filename of the root bundle', async function() {
    const outFile = 'custom-out-file.html';
    await bundle(__dirname + '/integration/html/index.html', {
      outFile
    });

    assert(fs.existsSync(__dirname, `/dist/${outFile}`));
  });

  describe('addURLDependency', () => {
    const bundleName = 'xyz';
    const options = {
      rootDir: '/root/dir',
      parser: {
        getAsset: () => {
          return {
            generateBundleName: () => bundleName
          };
        }
      }
    };
    const asset = new Asset('test', undefined, options);

    it('should ignore urls', () => {
      const url = 'https://parceljs.org/assets.html';
      assert.strictEqual(asset.addURLDependency(url), url);
    });

    it('should ignore empty string', () => {
      assert.strictEqual(asset.addURLDependency(''), '');
    });

    it('should generate bundle name', () => {
      assert.strictEqual(asset.addURLDependency('foo'), bundleName);
    });

    it('should preserve query and hash', () => {
      assert.strictEqual(
        asset.addURLDependency('foo#bar'),
        `${bundleName}#bar`
      );
      assert.strictEqual(
        asset.addURLDependency('foo?bar'),
        `${bundleName}?bar`
      );
      assert.strictEqual(
        asset.addURLDependency('foo?bar#baz'),
        `${bundleName}?bar#baz`
      );
    });
  });
});
