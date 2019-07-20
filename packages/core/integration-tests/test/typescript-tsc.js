import assert from 'assert';
import path from 'path';
import {bundle, run, distDir, outputFS} from '@parcel/test-utils';
import {readFileSync} from 'fs';

const configPath = path.join(
  __dirname,
  '/integration/typescript-config/.parcelrc'
);

const config = {
  ...JSON.parse(readFileSync(configPath)),
  filePath: configPath
};

describe('typescript', function() {
  it('should support loading tsconfig.json', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/typescript-config/index.ts'),
      {config}
    );

    let output = await run(b);
    assert.equal(output, 2);

    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!js.includes('/* test comment */'));
  });
});
