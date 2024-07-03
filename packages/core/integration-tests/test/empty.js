// @flow
import assert from 'assert';
import path from 'path';
import {
  fsFixture,
  assertBundles,
  run,
  overlayFS,
  bundle,
} from '@parcel/test-utils';

describe.only('empty', () => {
  it('should work', async () => {
    await fsFixture(overlayFS, __dirname)`
      empty-re-export
        empty.js:
          // intentionally empty
        thing.js:
          export const thing = 'thing';
        b.js:
          export * from './thing.js';
          export * from './empty.js';
        c.js:
          export var something = 'something';
          export * from './empty.js';
        a.js:
          export * from './c.js';
          export * from './b.js';
        index.js:
          import {thing} from './a.js';
          output(thing);
        index.html:
          <script src="./index.js" type="module" />
        yarn.lock:
          // Required for config loading
        package.json:
          {
            "@parcel/bundler-default": {
              "minBundleSize": 0,
              "manualSharedBundles": [{
                "name": "vendor",
                "root": "a.js",
                "assets": ["*.*"]
              }]
            }
          }
        `;

    let result = await bundle(
      path.join(__dirname, 'empty-re-export/index.html'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: true,
          shouldOptimize: false,
        },
        inputFS: overlayFS,
      },
    );

    let output;
    await run(result, {
      output(v) {
        output = v;
      },
    });

    assert.equal(output, 'thing');
  });
});
