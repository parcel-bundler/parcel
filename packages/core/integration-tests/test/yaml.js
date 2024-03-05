import assert from 'assert';
import path from 'path';
import {
  assertBundles,
  bundle,
  inputFS,
  outputFS,
  removeDistDirectory,
  run,
  runBundle,
} from '@parcel/test-utils';

describe.only('yaml', function () {
  beforeEach(async () => {
    await removeDistDirectory();
  });

  it('should support requiring YAML files', async function () {
    let b = await bundle(path.join(__dirname, '/integration/yaml/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.yaml'],
        childBundles: [
          {
            type: 'map',
          },
        ],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it.skip('should minify YAML for production', async function () {
    let b = await bundle(path.join(__dirname, '/integration/yaml/index.js'), {
      defaultTargetOptions: {
        shouldOptimize: true,
        shouldScopeHoist: false,
      },
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let json = await outputFS.readFile('dist/index.js', 'utf8');
    assert(json.includes('{a:1,b:{c:2}}'));
  });
});
