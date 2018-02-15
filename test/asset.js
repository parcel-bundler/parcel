const assert = require('assert');
const fs = require('fs');
const Asset = require('../src/Asset');
const {bundle} = require('./utils');

describe('Asset', () => {
  it('should include default implementations', async () => {
    const a = new Asset(__filename, undefined, {rootDir: '/root/dir'});
    Object.assign(a, {
      type: 'type',
      contents: 'contents'
    });

    const err = new Error();

    assert(a.shouldInvalidate() === false);
    assert(a.mightHaveDependencies());
    assert.deepEqual(await a.generate(), {
      type: 'contents'
    });
    assert.equal(a.generateErrorMessage(err), err);
  });

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
