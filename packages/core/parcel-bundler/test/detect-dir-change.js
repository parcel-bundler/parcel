const assert = require('assert');
const Path = require('path');
const fs = require('@parcel/fs');
const {sleep, ncp, bundler} = require('@parcel/test-utils');

let inputRoot = Path.join(__dirname, 'input', 'detect-dir-change');

describe.skip('detect directory changes', function() {
  beforeEach(async function() {
    await fs.rimraf(inputRoot);
    await fs.mkdirp(inputRoot);
    await ncp(__dirname + '/integration/detect-dir-change/', inputRoot);
  });

  describe('when a file matches a glob', async function() {
    it('should rebuild when the file is added', async function() {
      // 1. Bundle
      let b = bundler('test/input/detect-dir-change/src/*.js', {
        watch: true
      });
      await b.bundle();

      assert(await fs.exists(Path.join(__dirname, '/dist/', 'index.js')));

      // We'll check if bundle is called with this listener.
      let bundled = false;
      b.on('bundled', () => {
        bundled = true;
      });

      // 2. Write file and assert.
      await fs.writeFile(
        Path.join(inputRoot, './src/app.js'),
        "module.exports = function () { return 'app' }"
      );

      await sleep(1000);

      assert(bundled);
    });

    it('should rebuild when the file is removed', async function() {
      // 1. Add file and check the result bundle has all files.
      let filePath = Path.join(inputRoot, './src/app.js');
      await fs.writeFile(
        filePath,
        "module.exports = function () { return 'app' }"
      );

      let b = bundler('test/input/detect-dir-change/src/*.js', {
        watch: true
      });

      let bundle = await b.bundle();

      let childBundleNames = Array.from(bundle.childBundles.values()).map(
        bundle => Path.basename(bundle.name)
      );

      assert(childBundleNames.includes('index.js'));
      assert(childBundleNames.includes('app.js'));

      // We'll check if bundle is called with this listener.
      let bundled = false;
      b.on('bundled', () => {
        bundled = true;
      });

      // 2. Check dist file removed correctly.
      await fs.unlink(filePath);

      await sleep(1000);
      assert(bundled);
    });
  });

  describe('when a file does not match a glob', async function() {
    it('should not rebuild when the file is added', async function() {
      // 1. Bundle
      let b = bundler('test/input/detect-dir-change/src/*.js', {
        watch: true
      });
      await b.bundle();

      assert(await fs.exists(Path.join(__dirname, '/dist/', 'index.js')));

      // We'll check if bundle is called with this listener.
      let bundled = false;
      b.on('bundled', () => {
        bundled = true;
      });

      // 2. Create unrelated file and assert
      await fs.writeFile(
        Path.join(inputRoot, './src/app2.ts'),
        "module.exports = function () { return 'app' }"
      );

      await sleep(1000);
      assert(!bundled);
    });

    it('should not rebuild when the file is removed', async function() {
      // 1. Add file and check bundle has all files.
      let filePath = Path.join(inputRoot, './src/test.html');
      await fs.writeFile(filePath, '<html></html>');

      let b = bundler('test/input/detect-dir-change/src/*.js', {
        watch: true
      });

      let bundle = await b.bundle();

      assert(Path.basename(bundle.name), 'index.js');

      // We'll check if bundle is called with this listener.
      let bundled = false;
      b.on('bundled', () => {
        bundled = true;
      });

      // 2. Remove file and assert that bundle() isn't called.
      await fs.unlink(filePath);

      await sleep(1000);
      assert(!bundled);
    });
  });
});
