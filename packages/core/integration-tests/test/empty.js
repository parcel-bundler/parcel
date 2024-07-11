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
import type {Asset, BundleGraph} from '@parcel/types-internal';
import fs from 'fs';

async function diffAssets(
  graph1: BundleGraph,
  graph2: BundleGraph,
  overlayFS1,
  overlayFS2,
) {
  const bundles1 = graph1.getBundles();
  const bundles2 = graph2.getBundles();

  const codes2 = bundles2.map(bundle => {
    return overlayFS2.readFileSync(bundle.filePath, 'utf8');
  });

  console.log(bundles1);

  let i = 0;
  for (let file of codes2) {
    fs.writeFileSync('bundle-' + i, file);
    i += 1;
  }

  if (true) return;
  for (let bundle1 of bundles1) {
    const bundle2 = bundles2.find(b => b.name === bundle1.name);
    if (!bundle2) {
      throw new Error('no matching bundle for ' + bundle1.name);
    }

    const assetPairs = [];
    bundle1.traverseAssets((asset1: Asset) => {
      const asset2 = graph2.getAssetById(asset1.id);
      if (!asset2) {
        throw new Error('no matching asset for ' + asset1.filePath);
      }

      assetPairs.push({
        asset1,
        asset2,
      });
    });

    for (let {asset1, asset2} of assetPairs) {
      console.log('Checking', asset1.filePath);
      const dependencies1 = graph1.getDependencies(asset1);
      const dependencies2 = graph2.getDependencies(asset2);
      for (let dependency1 of dependencies1) {
        console.log('   -> Checking', dependency1.specifier);
        const dependency2 = dependencies2.find(
          d => d.specifier === dependency1.specifier,
        );
        if (!dependency2) {
          throw new Error('missing dependency ' + dependency1.specifier);
        }
        const symbols1 = graph1.getUsedSymbols(dependency1);
        const symbols2 = graph2.getUsedSymbols(dependency2);
        assert.deepEqual(symbols1, symbols2);
        assert.deepEqual(dependency1, dependency2);
      }

      {
        const symbols1 = asset1.symbols;
        const symbols2 = asset2.symbols;
        console.log(symbols1, symbols2);
        assert.deepEqual(
          Array.from(symbols1.exportSymbols()),
          Array.from(symbols2.exportSymbols()),
        );
      }

      {
        const symbols1 = graph1.getExportedSymbols(asset1);
        const symbols2 = graph2.getExportedSymbols(asset2);
        assert.deepEqual(symbols1, symbols2);
      }
      {
        const symbols1 = graph1.getUsedSymbols(asset1);
        const symbols2 = graph2.getUsedSymbols(asset2);
        assert.deepEqual(symbols1, symbols2);
      }

      // if (code1 !== code2) { //   throw new Error('code is different on assets ' + asset1.filePath);
      // }
      console.log('asset filepath=', asset1.filePath);
    }

    console.log('bundle filepath=', bundle1.filePath);
    if (bundle1.filePath.includes('html')) {
      continue;
    }
    const code1 = await overlayFS1.readFile(bundle1.filePath, 'utf8');
    const code2 = await overlayFS2.readFile(bundle2.filePath, 'utf8');
    // assert.deepEqual(code1, code2);
  }
  const codes1 = bundles1.map(bundle => {
    return overlayFS1.readFileSync(bundle.filePath, 'utf8');
  });
}

let overlayFS1;
let graph1;
describe.only('empty', () => {
  it('fixed case', async () => {
    await fsFixture(overlayFS, __dirname)`
      empty-re-export
        empty.js:
          // empty.js
          // intentionally empty
          // export const r = 10; // <- uncomment fix
        thing.js:
          // thing.js
          export const thing = 'thing';
        b.js:
          // b.js
          export * from './thing.js';
          export * from './empty.js';
        c.js:
          // c.js
          export var something = 'something';
          export * from './empty.js';
        a.js:
          // a.js
          export * from './c.js';
          export * from './b.js';
        index.js:
          // index.js
          import {thing} from './a.js';
          output(thing);
        index.html:
          <script src="./index.js" type="module" />
        yarn.lock:
          // Required for config loading
        package.json:
          {
            "@parcel/bundler-default": {
              "minBundleSize": 0
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

    overlayFS1 = overlayFS;
    graph1 = result;
    let output;
    await run(result, {
      output(v) {
        output = v;
      },
    });

    assert.equal(output, 'thing');
  });

  it('async', async () => {
    await fsFixture(overlayFS, __dirname)`
      empty-re-export
        empty.js:
          // empty.js
          // intentionally empty
          // export const r = 10; // <- uncomment fix
          // import './thing';
        thing.js:
          // thing.js
          export const thing = 'thing';
        c.js:
          // c.js
          export * from './empty.js';
        a.js:
          // a.js
          export * from './thing.js';
          export * from './c.js';
        index.js:
          // index.js
          // import {thing} from './a.js';
          // output(thing);

          output(import('./a.js').then(({thing}) => thing));
        index.html:
          <script src="./index.js" type="module" />
        yarn.lock:
          // Required for config loading
        package.json:
          {
            "@parcel/bundler-default": {
              "minBundleSize": 0
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
    await diffAssets(graph1, result, overlayFS1, overlayFS);

    let output;
    await run(result, {
      output(v) {
        output = v;
      },
    });

    assert.equal(await output, 'thing');
  });

  it.skip('should work', async () => {
    await fsFixture(overlayFS, __dirname)`
      empty-re-export
        empty.js:
          // empty.js
          // intentionally empty
          // export const r = 10; // <- uncomment fix
        thing.js:
          // thing.js
          export const thing = 'thing';
        b.js:
          // b.js
          export * from './thing.js';
          export * from './empty.js';
        c.js:
          // c.js
          export var something = 'something';
          export * from './empty.js';
        a.js:
          // a.js
          export * from './c.js';
          export * from './b.js';
        index.js:
          // index.js
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

    await diffAssets(graph1, result, overlayFS1, overlayFS);

    let output;
    await run(result, {
      output(v) {
        output = v;
      },
    });

    assert.equal(output, 'thing');
  });
});
