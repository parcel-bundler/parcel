// @flow
'use strict';

const PackagerRunner = require('../src/PackagerRunner');
const assert = require('assert');
const path = require('path');

describe('PackagerRunner', () => {
  it('works', async () => {
    let bundle = {
      destPath: path.join(__dirname, 'dist', 'bundle.js'),
      assets: [
        { code: require.resolve('./fixtures/module-a') },
        { code: require.resolve('./fixtures/module-b') },
      ],
    };

    let packagerRunner = new PackagerRunner({});

    await packagerRunner.runPackager({ bundle });
  });
});
