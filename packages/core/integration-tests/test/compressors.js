import assert from 'assert';
import path from 'path';
import zlib from 'zlib';
import {bundle, outputFS, distDir} from '@parcel/test-utils';

describe('compressors', function() {
  it('should compress output with gzip and brotli', async function() {
    await bundle(path.join(__dirname, 'integration/compressors/index.js'));

    let output = await outputFS.readdir(distDir);
    assert.deepEqual(output, [
      'index.js',
      'index.js.gz',
      'index.js.br',
      'index.js.map',
      'index.js.map.gz',
      'index.js.map.br',
    ]);

    let raw = await outputFS.readFile(path.join(distDir, 'index.js'));
    let gz = await outputFS.readFile(path.join(distDir, 'index.js.gz'));
    let br = await outputFS.readFile(path.join(distDir, 'index.js.br'));

    assert(zlib.gunzipSync(gz).equals(raw));
    assert(zlib.brotliDecompressSync(br).equals(raw));
  });

  it('should be able to disable raw output', async function() {
    await bundle(
      path.join(__dirname, 'integration/compressors-disable-default/index.js'),
    );

    let output = await outputFS.readdir(distDir);
    assert.deepEqual(output, ['index.js.br', 'index.js.map.br']);
  });
});
