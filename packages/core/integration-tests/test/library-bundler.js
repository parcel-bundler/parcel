// @flow strict-local
import assert from 'assert';
import path from 'path';
import {
  bundle,
  run,
  overlayFS,
  outputFS,
  fsFixture,
  assertBundles,
} from '@parcel/test-utils';

describe('library bundler', function () {
  let count = 0;
  let dir;
  beforeEach(async () => {
    dir = path.join(__dirname, 'libraries', '' + ++count);
    await overlayFS.mkdirp(dir);
  });

  after(async () => {
    await overlayFS.rimraf(path.join(__dirname, 'libraries'));
  });

  it('should support named imports', async function () {
    await fsFixture(overlayFS, dir)`
      yarn.lock:

      .parcelrc:
        {
          "extends": "@parcel/config-default",
          "bundler": "@parcel/bundler-library"
        }

      package.json:
        {
          "module": "dist/out.js"
        }

      index.js:
        export * from './foo';
        export * from './bar';

      foo.js:
        import {baz} from './baz';
        export function foo() {
          return 'foo' + baz();
        }
      
      bar.js:
        import {baz} from './baz';
        export function bar() {
          return 'bar' + baz();
        }

      baz.js:
        export function baz() {
          return 'baz';
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await run(b);
    assert.equal(res.foo(), 'foobaz');
    assert.equal(res.bar(), 'barbaz');

    assertBundles(b, [
      {
        assets: ['index.js'],
      },
      {
        assets: ['foo.js'],
      },
      {
        assets: ['bar.js'],
      },
      {
        assets: ['baz.js'],
      },
    ]);

    for (let bundle of b.getBundles()) {
      let contents = await outputFS.readFile(bundle.filePath, 'utf8');
      assert(!contents.includes('parcelRequire'));
      assert(contents.includes('export {'));
    }
  });
});
