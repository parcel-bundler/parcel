const assert = require('assert');
const Path = require('path');
const Bundler = require('../src/Bundler');

describe('typescript asset', () => {
  it('should be resolved with tsconfig paths when bundled', async () => {
    const filename = Path.normalize(
      Path.join(__dirname, '/integration/resolve-paths/index.ts')
    );

    const options = {
      outDir: Path.join(__dirname, './integration/resolve-paths/dist'),
      outFile: 'index.js',
      cache: false,
      hmr: false
    };

    const bundler = new Bundler(filename, options);
    const bundle = await bundler.bundle();

    const loadedAssets = [...bundle.assets.values()].map(asset => asset.id);

    assert.equal(loadedAssets.includes('index.ts'), true);
    assert.equal(loadedAssets.includes('app/foo.ts'), true);
    assert.equal(loadedAssets.includes('core/util/foo.ts'), true);
    assert.equal(loadedAssets.includes('src/foo.ts'), true);
  });
});
