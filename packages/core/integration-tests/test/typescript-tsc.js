import assert from 'assert';
import path from 'path';
import * as fs from '@parcel/fs';
import {bundle, run, distDir} from '@parcel/test-utils';
import tscConfigContents from '@parcel/config-tsc';

const config = {
  ...tscConfigContents,
  filePath: require.resolve('@parcel/config-tsc')
};

describe('typescript', function() {
  it('should support loading tsconfig.json', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/typescript-config/index.ts'),
      {config}
    );

    let output = await run(b);
    assert.equal(output, 2);

    let js = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!js.includes('/* test comment */'));
  });
});
