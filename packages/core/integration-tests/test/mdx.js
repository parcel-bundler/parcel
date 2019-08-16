const assert = require('assert');
const path = require('path');
const {
  bundle,
  assertBundles,
  distDir,
  outputFS,
  run
} = require('@parcel/test-utils');
import {readFileSync} from 'fs';

const configPath = path.join(__dirname, '/integration/mdx/.parcelrc');

const mdConfig = {
  ...JSON.parse(readFileSync(configPath)),
  filePath: configPath
};

describe('markdown/mdx', function() {
  for (let config of [null /* default config -- testing babel  */, mdConfig]) {
    it('should support bundling MDX', async function() {
      Error.stackTraceLimit = 1000;
      let b = await bundle(path.join(__dirname, '/integration/mdx/index.md'), {
        config
      });

      let output = await run(b);
      assert.equal(typeof output.default, 'function');

      let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
      assert(js.includes('This is a red heading'));
    });
  }
});
