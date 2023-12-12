// @flow
import assert from 'assert';
import path from 'path';
import {
  overlayFS,
  getParcelOptions,
  bundle,
  fsFixture,
} from '@parcel/test-utils';
import {NodePackageManager} from '@parcel/package-manager';
import resolveOptions from '@parcel/core/src/resolveOptions';
import {version} from '@parcel/core/package.json';
import {hashString} from '@parcel/rust';
const {
  AssetGraph,
  BundleGraph,
  RequestTracker: {
    default: RequestTracker,
    RequestGraph,
    requestGraphEdgeTypes,
  },
} = require('../../../dev/query/src/deep-imports.js');
import v8 from 'v8';
import {run} from '../../../dev/query/src/cli.js';

let resolvedOptions;
let requestGraph;
let bundleGraph;
let assetGraph;
describe('parcel-query', () => {
  before(async () => {
    let overlayFSPackageManager = new NodePackageManager(overlayFS, __dirname);
    let entries = 'source/index.js';
    let options = {
      mode: 'production',
      defaultTargetOptions: {
        shouldScopeHoist: false,
      },
      packageManager: overlayFSPackageManager,
      shouldDisableCache: false,
      inputFS: overlayFS,
      cacheDir: path.join(__dirname, '.parcel-cache'),
    };

    await fsFixture(overlayFS)`
          source
            a.js:
              import foo from './foo';

              export default 5;
            b.js:
              export default 4;
            bar.js:
              import a from './a';
              import b from './b';

              export default 3;
            foo.js:
              import a from './a';
              import b from './b';
    
              export default 2;
            index.js:
              import('./foo');
              import('./bar');
    
              export default 1;
            yarn.lock:`;

    await bundle(entries, options);
    assert(overlayFS.readdirSync(options.cacheDir));

    resolvedOptions = await resolveOptions(getParcelOptions(entries, options));

    let requestGraphKey = hashString(
      `${version}:${JSON.stringify(resolvedOptions.entries)}:${
        resolvedOptions.mode
      }:requestGraph`,
    );
    let bundleGraphKey = hashString(
      `${version}:BundleGraph:${JSON.stringify(resolvedOptions.entries) ?? ''}${
        resolvedOptions.mode
      }`,
    );
    let assetGraphKey = hashString(
      `${version}Main${JSON.stringify(resolvedOptions.entries) ?? ''}${
        resolvedOptions.mode
      }`,
    );

    requestGraph = RequestGraph.deserialize(
      v8.deserialize(await resolvedOptions.cache.getLargeBlob(requestGraphKey))
        .value,
    );
    bundleGraph = BundleGraph.deserialize(
      v8.deserialize(await resolvedOptions.cache.getLargeBlob(bundleGraphKey))
        .bundleGraph.value,
    );
    assetGraph = AssetGraph.deserialize(
      v8.deserialize(await resolvedOptions.cache.getLargeBlob(assetGraphKey))
        .assetGraph.value,
    );

    // TODO: Get BundleInfo
    assert(requestGraph);
    assert(bundleGraph);
    assert(assetGraph);
  });

  it.only('getBundles', async function () {
    run(['getBundles()'], resolvedOptions);
  });

  it('findAsset', async function () {});

  it('findAssetWithSymbol', async function () {});

  it('findAssetWithSymbol', async function () {});

  it('findBundleReason', async function () {});

  it('findEntries', async function () {});

  it('findEntriesAssetGraph', async function () {});

  it('findEntriesBundleGraph', async function () {});

  it('getAsset', async function () {});

  it('getAssetWithDependency', async function () {});

  it('getBundle', async function () {});

  it('getBundlesWithDependency', async function () {});

  it('getIncomingDependencies', async function () {});

  it('getIncomingDependenciesAssetGraph', async function () {});

  it('getIncomingDependenciesBundleGraph', async function () {});

  it('getNodeAssetGraph', async function () {});

  it('getNodeBundleGraph', async function () {});

  it('getReferencingBundles', async function () {});

  it('getResolvedAsset', async function () {});

  it('inspectCache', async function () {});

  it('stats', async function () {});

  it('traverseAssets', async function () {});

  it('traverseBundle', async function () {});
});
