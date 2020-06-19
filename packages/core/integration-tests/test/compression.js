import {bundle, assertBundles, defaultConfig} from '@parcel/test-utils';
import path from 'path';

let config = {
  ...defaultConfig,
  optimizers: {
    ...defaultConfig.optimizers,
    '*.html': [...defaultConfig.optimizers['*.html'], '@parcel/optimizer-gzip'],
    '*.js': [...defaultConfig.optimizers['*.js'], '@parcel/optimizer-gzip'],
    '*.css': [...defaultConfig.optimizers['*.css'], '@parcel/optimizer-gzip'],
  },
};

describe('compression', function() {
  it('should support compressing text with gzip', async () => {
    let b = await bundle(path.join(__dirname, '/integration/html/index.html'), {
      mode: 'production',
      defaultConfig: config,
    });

    assertBundles(b, [
      {
        name: 'index.html.gz',
        assets: ['index.html'],
      },
      {
        type: 'png',
        assets: ['100x100.png'],
      },
      {
        type: 'svg',
        assets: ['icons.svg'],
      },
      {
        type: 'css.gz',
        assets: ['index.css'],
      },
      {
        name: 'other.html.gz',
        assets: ['other.html'],
      },
      {
        type: 'js.gz',
        assets: ['index.js'],
      },
    ]);
  });
});
