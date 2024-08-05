import assert from 'assert';
import path from 'path';
import zlib from 'zlib';
import {bundle, describe, it, outputFS, distDir} from '@parcel/test-utils';

describe.v2('compressors', function () {
  it('should not compress output with gzip and brotli in development', async function () {
    await bundle(path.join(__dirname, 'integration/compressors/index.js'));

    let output = await outputFS.readdir(distDir);
    assert.deepEqual(output.sort(), ['index.js', 'index.js.map']);
  });

  it('should compress output with gzip and brotli', async function () {
    await bundle(path.join(__dirname, 'integration/compressors/index.js'), {
      mode: 'production',
    });

    let output = await outputFS.readdir(distDir);
    assert.deepEqual(output.sort(), [
      'index.js',
      'index.js.br',
      'index.js.gz',
      'index.js.map',
      'index.js.map.br',
      'index.js.map.gz',
    ]);

    let raw = await outputFS.readFile(path.join(distDir, 'index.js'));
    let gz = await outputFS.readFile(path.join(distDir, 'index.js.gz'));
    let br = await outputFS.readFile(path.join(distDir, 'index.js.br'));

    assert(zlib.gunzipSync(gz).equals(raw));
    assert(zlib.brotliDecompressSync(br).equals(raw));
  });

  it('should be able to disable raw output', async function () {
    await bundle(
      path.join(__dirname, 'integration/compressors-disable-default/index.js'),
      {
        mode: 'production',
      },
    );

    let output = await outputFS.readdir(distDir);
    assert.deepEqual(output.sort(), ['index.js.br', 'index.js.map.br']);
  });
});
