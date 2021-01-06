import assert from 'assert';
import {
  bundle,
  removeDistDirectory,
  distDir,
  outputFS,
} from '@parcel/test-utils';
import path from 'path';

describe('svg', function() {
  afterEach(async () => {
    await removeDistDirectory();
  });

  // ATLASSIAN modification: skip as this conflicts with our default config
  it.skip('should support transforming SVGs to react components', async function() {
    await bundle(path.join(__dirname, '/integration/svg/index.js'), {
      defaultConfig: path.join(
        __dirname,
        'integration/custom-configs/.parcelrc-svg',
      ),
    });

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf-8');
    assert(file.includes('function SvgIcon'));
    assert(file.includes('_reactDefault.default.createElement("svg"'));
  });
});
