// @flow strict-local

import assert from 'assert';
import path from 'path';
import {bundle, distDir, outputFS} from '@parcel/test-utils';

describe('blob urls', () => {
  it('should inline compiled content as a blob url with `blob-url:*` imports', async () => {
    await bundle(path.join(__dirname, '/integration/blob-url/index.js'));

    let bundleContent = await outputFS.readFile(
      path.join(distDir, 'index.js'),
      'utf8',
    );
    assert(bundleContent.includes('new Worker(require("blob-url:./worker"))'));
    assert(
      bundleContent.includes(
        'module.exports = URL.createObjectURL(new Blob(["// modules are defined as an array\\n',
      ),
    );
    assert(
      bundleContent.includes(
        'self.postMessage(\\"this should appear in the bundle\\\\n\\")',
      ),
    );
  });

  it('should inline minified content as a blob url with `blob-url:*` imports', async () => {
    await bundle(path.join(__dirname, '/integration/blob-url/index.js'), {
      minify: true,
    });

    let bundleContent = await outputFS.readFile(
      path.join(distDir, 'index.js'),
      'utf8',
    );
    assert(bundleContent.match(/new Worker\([^(]*\("blob-url:.\/worker"\)\)/));
    assert(
      bundleContent.includes(
        ".exports=URL.createObjectURL(new Blob(['!function(",
      ),
    );
    assert(
      bundleContent.includes(
        'self.postMessage("this should appear in the bundle\\\\n")',
      ),
    );
  });
});
