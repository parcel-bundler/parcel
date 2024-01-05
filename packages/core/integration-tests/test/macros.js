// @flow strict-local
import assert from 'assert';
import path from 'path';
import {bundle, run, overlayFS, fsFixture} from '@parcel/test-utils';

describe('macros', function () {
  let count = 0;
  let dir;
  beforeEach(async () => {
    dir = path.join(__dirname, 'macros', '' + ++count);
    await overlayFS.mkdirp(dir);
  });

  after(async () => {
    await overlayFS.rimraf(path.join(__dirname, 'macros'));
  });

  it('should support named imports', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { hash } from "./macro.js" with { type: "macro" };
        output = hash('hi');

      macro.js:
        import {hashString} from '@parcel/rust';
        export function hash(s) {
          return hashString(s);
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes('output="2a2300bbd7ea6e9a"'));
  });

  it('should support renamed imports', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { hashString as foo } from "@parcel/rust" with { type: "macro" };
        output = foo('hi');
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes('output="2a2300bbd7ea6e9a"'));
  });

  it('should support default imports', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import test from "./macro.js" with { type: "macro" };
        output = test('hi');

      macro.js:
        import {hashString} from '@parcel/rust';
        export default function test(s) {
          return hashString(s);
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes('output="2a2300bbd7ea6e9a"'));
  });

  it('should support namespace imports', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import * as ns from "@parcel/rust" with { type: "macro" };
        output = ns.hashString('hi');
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes('output="2a2300bbd7ea6e9a"'));
  });

  it('should support various JS value types', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { test } from "./macro.js" with { type: "macro" };
        output = test(undefined, null, true, false, 1, 0, -2, 'hi', /yo/i, [1, {test: 8}]);

      macro.js:
        import {inspect} from 'util';
        export function test(...args) {
          return inspect(args);
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await run(b);
    assert.equal(
      res,
      require('util').inspect([
        undefined,
        null,
        true,
        false,
        1,
        0,
        -2,
        'hi',
        /yo/i,
        [1, {test: 8}],
      ]),
    );
  });

  it('should support returning various JS value types', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { test } from "./macro.js" with { type: "macro" };
        output = test();

      macro.js:
        export function test() {
          return [undefined, null, true, false, 1, 0, -2, 'hi', /yo/i, [1, {test: 8}]];
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await run(b);
    assert.deepEqual(res, [
      undefined,
      null,
      true,
      false,
      1,
      0,
      -2,
      'hi',
      /yo/i,
      [1, {test: 8}],
    ]);
  });

  it('should support evaluating expressions', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { test } from "./macro.js" with { type: "macro" };
        output = test(1 + 2, 'foo ' + 'bar', !true, [1, ...[2, 3]], true ? 1 : 0, typeof false, null ?? 2);

      macro.js:
        export function test(...args) {
          return args;
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await run(b);
    assert.deepEqual(res, [3, 'foo bar', false, [1, 2, 3], 1, 'boolean', 2]);
  });

  it('should dead code eliminate falsy branches', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { test } from "./macro.js" with { type: "macro" };
        
        if (test()) {
          console.log('bad');
        } else {
          console.log('good');
        }

      macro.js:
        export function test() {
          return false;
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes('console.log("good")'));
    assert(!res.includes('console.log("bad")'));
  });

  it('should support async macros', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { test } from "./macro.js" with { type: "macro" };
        output = test();

      macro.js:
        export function test() {
          return Promise.resolve(2);
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes('output=2'));
  });

  it('should ignore macros in node_modules', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import test from "foo";
        output = test;

      node_modules/foo/index.js:
        import { test } from "./macro.js" with { type: "macro" };
        export default test();

      node_modules/foo/macro.js:
        export function test() {
          return 2;
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
    });

    let res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes('function test'));
  });

  it('should throw a diagnostic when an argument cannot be converted', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { test } from "./macro.js" with { type: "macro" };
        output = test(1, foo);

      macro.js:
        export function test() {
          return 2;
        }
    `;

    try {
      await bundle(path.join(dir, '/index.js'), {
        inputFS: overlayFS,
        mode: 'production',
      });
    } catch (err) {
      assert.deepEqual(err.diagnostics, [
        {
          message: 'Could not statically evaluate macro argument',
          origin: '@parcel/transformer-js',
          codeFrames: [
            {
              filePath: path.join(dir, 'index.js'),
              codeHighlights: [
                {
                  message: undefined,
                  start: {
                    line: 2,
                    column: 18,
                  },
                  end: {
                    line: 2,
                    column: 20,
                  },
                },
              ],
            },
          ],
          hints: null,
        },
      ]);
    }
  });

  it('should throw a diagnostic when a macro errors', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { test } from "./macro.js" with { type: "macro" };
        output = test(1);

      macro.js:
        exports.test = function test() {
          throw new Error('test');
        }
    `;

    try {
      await bundle(path.join(dir, '/index.js'), {
        inputFS: overlayFS,
        mode: 'production',
      });
    } catch (err) {
      assert(
        err.diagnostics[0].message.startsWith('Error evaluating macro: test'),
      );
      assert.deepEqual(err.diagnostics[0].codeFrames, [
        {
          filePath: path.join(dir, 'index.js'),
          codeHighlights: [
            {
              message: undefined,
              start: {
                line: 2,
                column: 10,
              },
              end: {
                line: 2,
                column: 16,
              },
            },
          ],
        },
      ]);
    }
  });

  it('should support returning functions', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { test } from "./macro.js" with { type: "macro" };
        output = test(1, 2)(3);

      macro.js:
        export function test(a, b) {
          return new Function('c', \`return \${a} + \${b} + c\`);
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes('output=6'));
  });

  it('should support macros written in typescript', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { test } from "./macro.ts" with { type: "macro" };
        output = test(1, 2);

      macro.ts:
        export function test(a: number, b: number) {
          return a + b;
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes('output=3'));
  });

  it('should allow emitting additional assets', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { css } from "./macro.ts" with { type: "macro" };
        output = css('background: red') + css('color: pink');

      macro.ts:
        export function css(v) {
          this.addAsset({
            type: 'css',
            content: '.foo {\\n' + v + '\\n}'
          });
          return 'foo';
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
    });

    let res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes('output="foofoo"'));

    res = await overlayFS.readFile(b.getBundles()[1].filePath, 'utf8');
    assert(res.includes('.foo{color:pink;background:red}'));
  });

  it('should invalidate the cache when changing a macro', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { test } from "./macro.js" with { type: "macro" };
        output = test();

      macro.js:
        export function test() {
          return 2;
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
      shouldDisableCache: false,
    });

    let res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes('output=2'));

    await fsFixture(overlayFS, dir)`
      macro.js:
        export function test() {
          return 3;
        }
    `;

    b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
      shouldDisableCache: false,
    });

    res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(res.includes('output=3'));
  });

  it('should invalidate the cache on build', async function () {
    await fsFixture(overlayFS, dir)`
      index.js:
        import { test } from "./macro.js" with { type: "macro" };
        output = test('test.txt');

      macro.js:
        export function test() {
          this.invalidateOnBuild();
          return Date.now();
        }
    `;

    let b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
      shouldDisableCache: false,
    });

    let res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    let match = res.match(/output=(\d+)/);
    assert(match);

    b = await bundle(path.join(dir, '/index.js'), {
      inputFS: overlayFS,
      mode: 'production',
      shouldDisableCache: false,
    });

    res = await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8');
    let match2 = res.match(/output=(\d+)/);
    assert(match2);
    assert.notEqual(match[1], match2[1]);
  });
});
