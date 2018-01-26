const {strictEqual} = require('assert');
const Asset = require('../src/Asset');

describe('Asset', () => {
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
      strictEqual(asset.addURLDependency(url), url);
    });

    it('should ignore empty string', () => {
      strictEqual(asset.addURLDependency(''), '');
    });

    it('should generate bundle name', () => {
      strictEqual(asset.addURLDependency('foo'), bundleName);
    });

    it('should preserve query and hash', () => {
      strictEqual(asset.addURLDependency('foo#bar'), `${bundleName}#bar`);
      strictEqual(asset.addURLDependency('foo?bar'), `${bundleName}?bar`);
      strictEqual(
        asset.addURLDependency('foo?bar#baz'),
        `${bundleName}?bar#baz`
      );
    });
  });
});
