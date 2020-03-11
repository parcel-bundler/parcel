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

  it('should support transforming SVGs to react components', async function() {
    await bundle(path.join(__dirname, '/integration/svg-react/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf-8');
    assert(file.includes('function SvgIcon'));
    assert(file.includes('_react.default.createElement("svg"'));
  });
});
