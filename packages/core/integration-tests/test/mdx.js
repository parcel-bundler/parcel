const assert = require('assert');
const path = require('path');
const {bundle, assertBundleTree, outputFS} = require('@parcel/test-utils');
import {readFileSync} from 'fs';

const configPath = path.join(__dirname, '/integration/mdx/.parcelrc');

const mdConfig = {
  ...JSON.parse(readFileSync(configPath)),
  filePath: configPath
};

describe.skip('markdown/mdx', function() {
  for (let config of [null /* default config -- testing babel  */, mdConfig]) {
    it('should support bundling MDX', async function() {
      Error.stackTraceLimit = 1000;
      let b = await bundle(path.join(__dirname, '/integration/mdx/index.md'), {
        config
      });

      console.log(b);
    });
  }
});
