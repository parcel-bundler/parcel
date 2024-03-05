import assert from 'assert';
import path from 'path';
import {bundle, removeDistDirectory, run} from '@parcel/test-utils';

describe.only('data-url:', function () {
  beforeEach(async () => {
    await removeDistDirectory();
  });

  it('should inline text content as url-encoded text and mime type with `data-url:*` imports', async () => {
    let b = await bundle(path.join(__dirname, '/integration/data-url/text.js'));

    assert.equal(
      (await run(b)).default,
      'data:image/svg+xml,%3Csvg%20width%3D%22120%22%20height%3D%22120%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%0A%20%20%3Cfilter%20id%3D%22blur-_.%21~%2a%22%3E%0A%20%20%20%20%3CfeGaussianBlur%20stdDeviation%3D%225%22%3E%3C%2FfeGaussianBlur%3E%0A%20%20%3C%2Ffilter%3E%0A%20%20%3Ccircle%20cx%3D%2260%22%20cy%3D%2260%22%20r%3D%2250%22%20fill%3D%22green%22%20filter%3D%22url%28%27%23blur-_.%21~%2a%27%29%22%3E%3C%2Fcircle%3E%0A%3C%2Fsvg%3E%0A',
    );
  });

  it('should inline binary content as url-encoded base64 and mime type with `data-url:*` imports', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/data-url/binary.js'),
    );
    ``;

    assert((await run(b)).default.startsWith('data:image/webp;base64,UklGR'));
  });
});
