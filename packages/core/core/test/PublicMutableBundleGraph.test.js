// @flow strict-local

import type {Dependency} from '@parcel/types';

import assert from 'assert';
import invariant from 'assert';
import InternalBundleGraph from '../src/BundleGraph';
import MutableBundleGraph from '../src/public/MutableBundleGraph';
import {DEFAULT_ENV, DEFAULT_TARGETS, DEFAULT_OPTIONS} from './test-utils';
import AssetGraph, {nodeFromAssetGroup} from '../src/AssetGraph';
import {createAsset} from '../src/assetUtils';
import {createDependency} from '../src/Dependency';
import nullthrows from 'nullthrows';

const id1 = '0123456789abcdef0123456789abcdef';
const id2 = '9876543210fedcba9876543210fedcba';

describe('MutableBundleGraph', () => {
  it('creates publicIds for bundles', () => {
    let internalBundleGraph = InternalBundleGraph.fromAssetGraph(
      createMockAssetGraph(),
    );
    let mutableBundleGraph = new MutableBundleGraph(
      internalBundleGraph,
      DEFAULT_OPTIONS,
    );

    mutableBundleGraph.traverse(node => {
      if (
        node.type === 'dependency' &&
        mutableBundleGraph.getDependencyResolution(node.value)
      ) {
        let target = nullthrows(node.value.target);
        let group = mutableBundleGraph.createBundleGroup(node.value, target);
        let resolved = mutableBundleGraph.getDependencyResolution(node.value);
        if (resolved != null) {
          mutableBundleGraph.addBundleToBundleGroup(
            mutableBundleGraph.createBundle({
              entryAsset: resolved,
              target,
            }),
            group,
          );
        }
      }
    });

    assert.deepEqual(
      internalBundleGraph.getBundles().map(b => b.publicId),
      ['2iKuX', '7cqnn'],
    );
  });

  it('is safe to add a bundle to a bundleGroup multiple times', () => {
    let internalBundleGraph = InternalBundleGraph.fromAssetGraph(
      createMockAssetGraph(),
    );
    let mutableBundleGraph = new MutableBundleGraph(
      internalBundleGraph,
      DEFAULT_OPTIONS,
    );

    let dependency: Dependency;
    mutableBundleGraph.traverse((node, _, actions) => {
      if (node.type === 'dependency') {
        dependency = node.value;
        actions.stop();
      }
    });

    invariant(dependency != null);

    let target = nullthrows(dependency.target);
    let bundleGroup = mutableBundleGraph.createBundleGroup(dependency, target);
    let bundle = mutableBundleGraph.createBundle({
      entryAsset: nullthrows(
        mutableBundleGraph.getDependencyResolution(dependency),
      ),
      target,
    });

    mutableBundleGraph.addBundleToBundleGroup(bundle, bundleGroup);
    mutableBundleGraph.addBundleToBundleGroup(bundle, bundleGroup);
  });
});

const stats = {size: 0, time: 0};
function createMockAssetGraph() {
  let graph = new AssetGraph();
  graph.setRootConnections({
    entries: ['./index', './index2'],
  });

  graph.resolveEntry(
    './index',
    [{filePath: '/path/to/index/src/main.js', packagePath: '/path/to/index'}],
    '1',
  );
  graph.resolveEntry(
    './index2',
    [{filePath: '/path/to/index/src/main2.js', packagePath: '/path/to/index'}],
    '2',
  );
  graph.resolveTargets(
    {filePath: '/path/to/index/src/main.js', packagePath: '/path/to/index'},
    DEFAULT_TARGETS,
    '3',
  );
  graph.resolveTargets(
    {filePath: '/path/to/index/src/main2.js', packagePath: '/path/to/index'},
    DEFAULT_TARGETS,
    '4',
  );

  let dep1 = createDependency({
    moduleSpecifier: '/path/to/index/src/main.js',
    isEntry: true,
    env: DEFAULT_ENV,
    target: DEFAULT_TARGETS[0],
  });
  let dep2 = createDependency({
    moduleSpecifier: '/path/to/index/src/main2.js',
    isEntry: true,
    env: DEFAULT_ENV,
    target: DEFAULT_TARGETS[0],
  });

  let filePath = '/index.js';
  let req1 = {filePath, env: DEFAULT_ENV, query: {}};
  graph.resolveDependency(dep1, nodeFromAssetGroup(req1).value, '5');
  graph.resolveAssetGroup(
    req1,
    [
      createAsset({
        id: id1,
        filePath,
        type: 'js',
        isSource: true,
        hash: '#1',
        stats,
        env: DEFAULT_ENV,
      }),
    ],
    '6',
  );

  filePath = '/index2.js';
  let req2 = {filePath, env: DEFAULT_ENV, query: {}};
  graph.resolveDependency(dep2, nodeFromAssetGroup(req2).value, '7');
  graph.resolveAssetGroup(
    req2,
    [
      createAsset({
        id: id2,
        filePath,
        type: 'js',
        isSource: true,
        hash: '#2',
        stats,
        env: DEFAULT_ENV,
      }),
    ],
    '8',
  );

  return graph;
}
