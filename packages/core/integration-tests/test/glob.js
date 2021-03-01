// @flow
import assert from 'assert';
import path from 'path';
import {bundle, run, assertBundles, outputFS} from '@parcel/test-utils';
import nullthrows from 'nullthrows';

describe('glob', function() {
  it('should require a glob of files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/glob/index.js'));

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', '*.js', 'a.js', 'b.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should require nested directories with a glob', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/glob-deep/index.js'),
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', '*.js', 'a.js', 'b.js', 'c.js', 'z.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 13);
  });

  it('should support importing a glob of CSS files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/glob-css/index.js'),
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        name: 'index.css',
        assets: ['*.css', 'index.css', 'other.css', 'local.css'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(
      nullthrows(b.getBundles().find(b => b.type === 'css')).filePath,
      'utf8',
    );
    assert(css.includes('.local'));
    assert(css.includes('.other'));
    assert(css.includes('.index'));
  });

  it('should require a glob using a pipeline', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/glob-pipeline/index.js'),
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          '*.js',
          'bundle-url.js',
          'JSRuntime.js',
          'JSRuntime.js',
        ],
      },
      {
        type: 'txt',
        assets: ['a.txt'],
      },
      {
        type: 'txt',
        assets: ['b.txt'],
      },
    ]);

    let output = await run(b);
    assert.deepEqual(output, {
      a: `http://localhost/${
        nullthrows(b.getBundles().find(b => b.name.startsWith('a'))).name
      }`,
      b: `http://localhost/${
        nullthrows(b.getBundles().find(b => b.name.startsWith('b'))).name
      }`,
    });
  });
});
