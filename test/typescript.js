const assert = require('assert');
const path = require('path');
const fs = require('../src/utils/fs');
const {bundle, run, assertBundleTree} = require('./utils');

describe('typescript', function() {
  it('should produce a ts bundle using ES6 imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/typescript/index.ts')
    );

    assert.equal(b.assets.size, 2);
    assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output.count, 'function');
    assert.equal(output.count(), 3);
  });

  it('should produce a ts bundle using commonJS require', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/typescript-require/index.ts')
    );

    assert.equal(b.assets.size, 2);
    assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output.count, 'function');
    assert.equal(output.count(), 3);
  });

  it('should support json require', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/typescript-json/index.ts')
    );

    assert.equal(b.assets.size, 2);
    assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output.count, 'function');
    assert.equal(output.count(), 3);
  });

  it('should support env variables', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/typescript-env/index.ts')
    );

    assert.equal(b.assets.size, 1);
    assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output.env, 'function');
    assert.equal(output.env(), 'test');
  });

  it('should support importing a URL to a raw asset', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/typescript-raw/index.ts')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.ts', 'test.txt'],
      childBundles: [
        {
          type: 'map'
        },
        {
          type: 'txt',
          assets: ['test.txt'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output.getRaw, 'function');
    assert(/^\/test\.[0-9a-f]+\.txt$/.test(output.getRaw()));
    assert(await fs.exists(path.join(__dirname, '/dist/', output.getRaw())));
  });

  it('should minify in production mode', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/typescript-require/index.ts'),
      {production: true}
    );

    assert.equal(b.assets.size, 2);
    assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output.count, 'function');
    assert.equal(output.count(), 3);

    let js = await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
    assert(!js.includes('local.a'));
  });

  it('should support loading tsconfig.json', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/typescript-config/index.ts')
    );

    let output = await run(b);
    assert.equal(output, 2);

    let js = await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
    assert(!js.includes('/* test comment */'));
  });

  it('should support compiling JSX', async function() {
    await bundle(path.join(__dirname, '/integration/typescript-jsx/index.tsx'));

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(file.includes('React.createElement("div"'));
  });

  it('should use esModuleInterop by default', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/typescript-interop/index.ts')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.ts', 'commonjs-module.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'test passed');
  });

  it('fs.readFileSync should inline a file as a string', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/typescript-fs/index.ts')
    );

    const text = 'export default <div>Hello</div>;';
    let output = await run(b);

    assert.deepEqual(output, {
      fromTs: text,
      fromTsx: text
    });
  });
});
