// @flow strict-local
import assert from 'assert';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import {Dependency} from '@parcel/rust';
import AssetGraph, {
  nodeFromAssetGroup,
  nodeFromDep,
  nodeFromEntryFile,
  nodeFromAsset,
} from '../src/AssetGraph';
import {
  createDependency as _createDependency,
  dependencyId,
  type DependencyOpts,
} from '../src/Dependency';
import {
  createAsset as _createAsset,
  type AssetOptions,
} from '../src/assetUtils';
import {DB as db, DEFAULT_ENV, DEFAULT_TARGETS} from './test-utils';
import {toProjectPath as _toProjectPath} from '../src/projectPath';

const stats = {size: 0, time: 0};

let projectRoot = '/';

function createAsset(opts: AssetOptions) {
  return _createAsset(db, projectRoot, opts);
}

function createDependency(opts: DependencyOpts) {
  return _createDependency(db, projectRoot, opts);
}

function toProjectPath(p) {
  return _toProjectPath(projectRoot, p);
}

describe('AssetGraph', () => {
  it('initialization should create one root node with edges to entry_specifier nodes for each entry', () => {
    let graph = new AssetGraph(db);
    graph.setRootConnections({
      entries: [
        toProjectPath('/path/to/index1'),
        toProjectPath('/path/to/index2'),
      ],
    });

    assert(graph.hasNode(nullthrows(graph.rootNodeId)));
    assert(graph.hasContentKey('entry_specifier:path/to/index1'));
    assert(graph.hasContentKey('entry_specifier:path/to/index2'));
  });

  it('resolveEntry should connect an entry_specifier node to entry_file nodes', () => {
    let graph = new AssetGraph(db);
    graph.setRootConnections({
      entries: [
        toProjectPath('/path/to/index1'),
        toProjectPath('/path/to/index2'),
      ],
    });

    graph.resolveEntry(
      toProjectPath('/path/to/index1'),
      [
        {
          filePath: toProjectPath('/path/to/index1/src/main.js'),
          packagePath: toProjectPath('/path/to/index1'),
        },
      ],
      '123',
    );

    assert(
      graph.hasContentKey(
        nodeFromEntryFile({
          filePath: toProjectPath('/path/to/index1/src/main.js'),
          packagePath: toProjectPath('/path/to/index1'),
        }).id,
      ),
    );
    assert(
      graph.hasEdge(
        graph.getNodeIdByContentKey('entry_specifier:path/to/index1'),
        graph.getNodeIdByContentKey(
          nodeFromEntryFile({
            filePath: toProjectPath('/path/to/index1/src/main.js'),
            packagePath: toProjectPath('/path/to/index1'),
          }).id,
        ),
      ),
    );
  });

  it('resolveTargets should connect an entry_file node to dependencies for each target', () => {
    let graph = new AssetGraph(db);
    graph.setRootConnections({
      entries: [
        toProjectPath('/path/to/index1'),
        toProjectPath('/path/to/index2'),
      ],
    });

    graph.resolveEntry(
      toProjectPath('/path/to/index1'),
      [
        {
          filePath: toProjectPath('/path/to/index1/src/main.js'),
          packagePath: toProjectPath('/path/to/index1'),
        },
      ],
      '1',
    );

    graph.resolveEntry(
      toProjectPath('/path/to/index2'),
      [
        {
          filePath: toProjectPath('/path/to/index2/src/main.js'),
          packagePath: toProjectPath('/path/to/index2'),
        },
      ],
      '2',
    );

    graph.resolveTargets(
      {
        filePath: toProjectPath('/path/to/index1/src/main.js'),
        packagePath: toProjectPath('/path/to/index1'),
      },
      DEFAULT_TARGETS,
      '3',
    );

    graph.resolveTargets(
      {
        filePath: toProjectPath('/path/to/index2/src/main.js'),
        packagePath: toProjectPath('/path/to/index2'),
      },
      DEFAULT_TARGETS,
      '4',
    );

    assert(
      graph.hasContentKey(
        db.getStringId(
          dependencyId(db, {
            specifier: 'path/to/index1/src/main.js',
            specifierType: 'esm',
            target: DEFAULT_TARGETS[0],
            env: DEFAULT_ENV,
          }),
        ),
      ),
    );

    assert(
      graph.hasContentKey(
        db.getStringId(
          dependencyId(db, {
            specifier: 'path/to/index2/src/main.js',
            specifierType: 'esm',
            target: DEFAULT_TARGETS[0],
            env: DEFAULT_ENV,
          }),
        ),
      ),
    );

    assert.deepEqual(Array.from(graph.getAllEdges()), [
      {
        from: graph.rootNodeId,
        to: graph.getNodeIdByContentKey('entry_specifier:path/to/index1'),
        type: 1,
      },
      {
        from: graph.rootNodeId,
        to: graph.getNodeIdByContentKey('entry_specifier:path/to/index2'),
        type: 1,
      },
      {
        from: graph.getNodeIdByContentKey('entry_specifier:path/to/index1'),
        to: graph.getNodeIdByContentKey(
          nodeFromEntryFile({
            filePath: toProjectPath('/path/to/index1/src/main.js'),
            packagePath: toProjectPath('/path/to/index1'),
          }).id,
        ),
        type: 1,
      },
      {
        from: graph.getNodeIdByContentKey('entry_specifier:path/to/index2'),
        to: graph.getNodeIdByContentKey(
          nodeFromEntryFile({
            filePath: toProjectPath('/path/to/index2/src/main.js'),
            packagePath: toProjectPath('/path/to/index2'),
          }).id,
        ),
        type: 1,
      },
      {
        from: graph.getNodeIdByContentKey(
          nodeFromEntryFile({
            filePath: toProjectPath('/path/to/index1/src/main.js'),
            packagePath: toProjectPath('/path/to/index1'),
          }).id,
        ),
        to: graph.getNodeIdByContentKey(
          db.getStringId(
            dependencyId(db, {
              specifier: 'path/to/index1/src/main.js',
              specifierType: 'esm',
              target: DEFAULT_TARGETS[0],
              env: DEFAULT_ENV,
            }),
          ),
        ),
        type: 1,
      },
      {
        from: graph.getNodeIdByContentKey(
          nodeFromEntryFile({
            filePath: toProjectPath('/path/to/index2/src/main.js'),
            packagePath: toProjectPath('/path/to/index2'),
          }).id,
        ),
        to: graph.getNodeIdByContentKey(
          db.getStringId(
            dependencyId(db, {
              specifier: 'path/to/index2/src/main.js',
              specifierType: 'esm',
              target: DEFAULT_TARGETS[0],
              env: DEFAULT_ENV,
            }),
          ),
        ),
        type: 1,
      },
    ]);
  });

  it('resolveDependency should update the file a dependency is connected to', () => {
    let graph = new AssetGraph(db);
    graph.setRootConnections({
      targets: DEFAULT_TARGETS,
      entries: [toProjectPath('/path/to/index')],
    });

    graph.resolveEntry(
      toProjectPath('/path/to/index'),
      [
        {
          filePath: toProjectPath('/path/to/index/src/main.js'),
          packagePath: toProjectPath('/path/to/index'),
        },
      ],
      '1',
    );

    graph.resolveTargets(
      {
        filePath: toProjectPath('/path/to/index/src/main.js'),
        packagePath: toProjectPath('/path/to/index'),
      },
      DEFAULT_TARGETS,
      '2',
    );

    let dep = createDependency({
      specifier: 'path/to/index/src/main.js',
      specifierType: 'esm',
      target: DEFAULT_TARGETS[0],
      env: DEFAULT_ENV,
    });

    let req = {
      filePath: toProjectPath('/index.js'),
      env: DEFAULT_ENV,
    };

    graph.resolveDependency(dep, req, '3');
    let assetGroupNodeId = graph.getNodeIdByContentKey(
      nodeFromAssetGroup(req).id,
    );
    let dependencyNodeId = graph.getNodeIdByContentKey(
      Dependency.get(db, dep).id,
    );
    assert(graph.hasNode(assetGroupNodeId));
    assert(graph.hasEdge(dependencyNodeId, assetGroupNodeId));

    let req2 = {
      filePath: toProjectPath('/index.jsx'),
      env: DEFAULT_ENV,
    };
    graph.resolveDependency(dep, req2, '4');

    let assetGroupNodeId2 = graph.getNodeIdByContentKey(
      nodeFromAssetGroup(req2).id,
    );
    assert(!graph.hasNode(assetGroupNodeId));
    assert(graph.hasNode(assetGroupNodeId2));
    assert(graph.hasEdge(dependencyNodeId, assetGroupNodeId2));
    assert(!graph.hasEdge(dependencyNodeId, assetGroupNodeId));

    graph.resolveDependency(dep, req2, '5');
    assert(graph.hasNode(assetGroupNodeId2));
    assert(graph.hasEdge(dependencyNodeId, assetGroupNodeId2));
  });

  it('resolveAssetGroup should update the asset and dep nodes a file is connected to', () => {
    let graph = new AssetGraph(db);
    graph.setRootConnections({
      targets: DEFAULT_TARGETS,
      entries: [toProjectPath('/path/to/index')],
    });

    graph.resolveEntry(
      toProjectPath('/path/to/index'),
      [
        {
          filePath: toProjectPath('/path/to/index/src/main.js'),
          packagePath: toProjectPath('/path/to/index'),
        },
      ],
      '1',
    );
    graph.resolveTargets(
      {
        filePath: toProjectPath('/path/to/index/src/main.js'),
        packagePath: toProjectPath('/path/to/index'),
      },
      DEFAULT_TARGETS,
      '2',
    );

    let dep = createDependency({
      specifier: 'path/to/index/src/main.js',
      specifierType: 'esm',
      target: DEFAULT_TARGETS[0],
      env: DEFAULT_ENV,
      sourcePath: '',
    });

    let sourcePath = '/index.js';
    let filePath = toProjectPath(sourcePath);

    let asset1 = createAsset({
      id: '1',
      filePath,
      type: 'js',
      isSource: true,
      stats,
      env: DEFAULT_ENV,
    });

    let asset2 = createAsset({
      id: '2',
      filePath,
      type: 'js',
      isSource: true,
      stats,
      env: DEFAULT_ENV,
    });

    let asset3 = createAsset({
      id: '3',
      filePath,
      type: 'js',
      isSource: true,
      env: DEFAULT_ENV,
      stats,
    });

    let dep1 = createDependency({
      specifier: './utils',
      specifierType: 'esm',
      env: DEFAULT_ENV,
      sourcePath,
    });

    let dep2 = createDependency({
      specifier: './styles',
      specifierType: 'esm',
      env: DEFAULT_ENV,
      sourcePath,
    });

    let req = {filePath, env: DEFAULT_ENV};
    let assets = [
      {
        asset: asset1.addr,
        dependencies: [dep1],
      },
      {
        asset: asset2.addr,
        dependencies: [dep2],
      },
      {
        asset: asset3.addr,
        dependencies: [],
      },
    ];

    graph.resolveDependency(dep, req, '3');
    graph.resolveAssetGroup(req, assets, '4');

    let nodeId1 = graph.getNodeIdByContentKey(asset1.id);
    let nodeId2 = graph.getNodeIdByContentKey(asset2.id);
    let nodeId3 = graph.getNodeIdByContentKey(asset3.id);

    let assetGroupNode = graph.getNodeIdByContentKey(
      nodeFromAssetGroup(req).id,
    );

    let dependencyNodeId1 = graph.getNodeIdByContentKey(
      Dependency.get(db, dep1).id,
    );

    let dependencyNodeId2 = graph.getNodeIdByContentKey(
      Dependency.get(db, dep2).id,
    );

    assert(graph.hasNode(nodeId1));
    assert(graph.hasNode(nodeId2));
    assert(graph.hasNode(nodeId3));
    assert(graph.hasNode(dependencyNodeId1));
    assert(graph.hasNode(dependencyNodeId2));
    assert(graph.hasEdge(assetGroupNode, nodeId1));
    assert(graph.hasEdge(assetGroupNode, nodeId2));
    assert(graph.hasEdge(assetGroupNode, nodeId3));
    assert(graph.hasEdge(nodeId1, dependencyNodeId1));
    assert(graph.hasEdge(nodeId2, dependencyNodeId2));

    let assets2 = [
      {
        asset: createAsset({
          id: '1',
          filePath,
          type: 'js',
          isSource: true,
          stats,
          env: DEFAULT_ENV,
        }).addr,
        dependencies: [
          createDependency({
            specifier: './utils',
            specifierType: 'esm',
            env: DEFAULT_ENV,
            sourcePath,
          }),
        ],
      },
      {
        asset: createAsset({
          id: '2',
          filePath,
          type: 'js',
          isSource: true,
          stats,
          env: DEFAULT_ENV,
        }).addr,
        dependencies: [],
      },
    ];

    graph.resolveAssetGroup(req, assets2, '5');

    assert(graph.hasNode(nodeId1));
    assert(graph.hasNode(nodeId2));
    assert(!graph.hasNode(nodeId3));
    assert(graph.hasNode(dependencyNodeId1));
    assert(!graph.hasNode(dependencyNodeId2));
    assert(graph.hasEdge(assetGroupNode, nodeId1));
    assert(graph.hasEdge(assetGroupNode, nodeId2));
    assert(!graph.hasEdge(assetGroupNode, nodeId3));
    assert(graph.hasEdge(nodeId1, dependencyNodeId1));
    assert(!graph.hasEdge(nodeId2, dependencyNodeId2));
  });

  // Assets can define dependent assets in the same asset group by declaring a dependency with a module
  // specifier that matches the dependent asset's unique key. These dependent assets are then connected
  // to the asset's dependency instead of the asset group.
  it('resolveAssetGroup should handle dependent assets in asset groups', () => {
    let graph = new AssetGraph(db);
    graph.setRootConnections({
      targets: DEFAULT_TARGETS,
      entries: [toProjectPath('/index')],
    });

    graph.resolveEntry(
      toProjectPath('/index'),
      [
        {
          filePath: toProjectPath('/path/to/index/src/main.js'),
          packagePath: toProjectPath('/path/to/index'),
        },
      ],
      '1',
    );
    graph.resolveTargets(
      {
        filePath: toProjectPath('/path/to/index/src/main.js'),
        packagePath: toProjectPath('/path/to/index'),
      },
      DEFAULT_TARGETS,
      '2',
    );

    let dep = createDependency({
      specifier: 'path/to/index/src/main.js',
      specifierType: 'esm',
      env: DEFAULT_ENV,
      target: DEFAULT_TARGETS[0],
    });
    let sourcePath = '/index.js';
    let filePath = toProjectPath(sourcePath);
    let req = {filePath, env: DEFAULT_ENV};

    let asset1 = createAsset({
      id: '1',
      filePath,
      type: 'js',
      isSource: true,
      stats,
      env: DEFAULT_ENV,
    });

    let asset2 = createAsset({
      id: '2',
      uniqueKey: 'dependent-asset-1',
      filePath,
      type: 'js',
      isSource: true,
      stats,
      env: DEFAULT_ENV,
    });

    let asset3 = createAsset({
      id: '3',
      uniqueKey: 'dependent-asset-2',
      filePath,
      type: 'js',
      isSource: true,
      stats,
      env: DEFAULT_ENV,
    });

    let dep1 = createDependency({
      specifier: 'dependent-asset-1',
      specifierType: 'esm',
      env: DEFAULT_ENV,
      sourcePath,
    });

    let dep2 = createDependency({
      specifier: 'dependent-asset-2',
      specifierType: 'esm',
      env: DEFAULT_ENV,
      sourcePath,
    });

    let assets = [
      {
        asset: asset1.addr,
        dependencies: [dep1],
      },
      {
        asset: asset2.addr,
        dependencies: [dep2],
      },
      {
        asset: asset3.addr,
        dependencies: [],
      },
    ];

    graph.resolveDependency(dep, req, '123');
    graph.resolveAssetGroup(req, assets, '3');

    let nodeId1 = graph.getNodeIdByContentKey(asset1.id);
    let nodeId2 = graph.getNodeIdByContentKey(asset2.id);
    let nodeId3 = graph.getNodeIdByContentKey(asset3.id);

    let assetGroupNodeId = graph.getNodeIdByContentKey(
      nodeFromAssetGroup(req).id,
    );

    let depNodeId1 = graph.getNodeIdByContentKey(nodeFromDep(db, dep1).id);
    let depNodeId2 = graph.getNodeIdByContentKey(nodeFromDep(db, dep2).id);

    assert(nodeId1);
    assert(nodeId2);
    assert(nodeId3);
    assert(graph.hasEdge(assetGroupNodeId, nodeId1));
    assert(!graph.hasEdge(assetGroupNodeId, nodeId2));
    assert(!graph.hasEdge(assetGroupNodeId, nodeId3));
    assert(graph.hasEdge(nodeId1, depNodeId1));
    assert(graph.hasEdge(depNodeId1, nodeId2));
    assert(graph.hasEdge(nodeId2, depNodeId2));
    assert(graph.hasEdge(depNodeId2, nodeId3));
  });

  it('should support marking and unmarking all parents with hasDeferred', () => {
    let graph = new AssetGraph(db);

    let indexAssetGroup = {
      filePath: toProjectPath('/index.js'),
      env: DEFAULT_ENV,
    };

    let indexFooDep = createDependency({
      specifier: './foo',
      specifierType: 'esm',
      env: DEFAULT_ENV,
      sourcePath: '/index.js',
    });

    let indexBarDep = createDependency({
      specifier: './bar',
      specifierType: 'esm',
      env: DEFAULT_ENV,
      sourcePath: '/index.js',
    });

    let fooAssetGroup = {
      filePath: toProjectPath('/foo.js'),
      env: DEFAULT_ENV,
    };

    graph.setRootConnections({assetGroups: [indexAssetGroup]});
    graph.resolveAssetGroup(
      indexAssetGroup,
      [
        {
          asset: createAsset({
            id: 'assetIndex',
            filePath: toProjectPath('/index.js'),
            type: 'js',
            isSource: true,
            stats,
            env: DEFAULT_ENV,
          }).addr,
          dependencies: [indexFooDep, indexBarDep],
        },
      ],
      '0',
    );

    // index imports foo
    graph.resolveDependency(indexFooDep, fooAssetGroup, '0');

    let fooAssetGroupNode = nodeFromAssetGroup(fooAssetGroup);
    let fooUtilsDep = createDependency({
      specifier: './utils',
      specifierType: 'esm',
      env: DEFAULT_ENV,
      sourcePath: '/foo.js',
    });
    let fooUtilsDepNode = nodeFromDep(db, fooUtilsDep);
    let fooAsset = createAsset({
      id: 'assetFoo',
      filePath: toProjectPath('/foo.js'),
      type: 'js',
      isSource: true,
      stats,
      env: DEFAULT_ENV,
    });
    let fooAssetNode = nodeFromAsset(db, fooAsset.addr);
    let utilsAssetGroup = {
      filePath: toProjectPath('/utils.js'),
      env: DEFAULT_ENV,
    };
    let utilsAssetGroupNode = nodeFromAssetGroup(utilsAssetGroup);

    graph.resolveAssetGroup(
      fooAssetGroup,
      [{asset: fooAsset.addr, dependencies: [fooUtilsDep]}],
      '0',
    );
    graph.resolveDependency(fooUtilsDep, utilsAssetGroup, '0');

    // foo's dependency is deferred
    graph.markParentsWithHasDeferred(
      graph.getNodeIdByContentKey(fooUtilsDepNode.id),
    );
    let node = nullthrows(graph.getNodeByContentKey(fooAssetNode.id));
    invariant(node.type === 'asset');
    assert(node.hasDeferred);
    node = nullthrows(graph.getNodeByContentKey(fooAssetGroupNode.id));
    invariant(node.type === 'asset_group');
    assert(node.hasDeferred);

    // index also imports bar
    let barAssetGroup = {
      filePath: toProjectPath('/bar.js'),
      env: DEFAULT_ENV,
    };
    graph.resolveDependency(indexBarDep, barAssetGroup, '0');
    let barAssetGroupNode = nodeFromAssetGroup(barAssetGroup);
    let barUtilsDep = createDependency({
      specifier: './utils',
      specifierType: 'esm',
      env: DEFAULT_ENV,
      sourcePath: '/bar.js',
    });
    let barAsset = createAsset({
      id: 'assetBar',
      filePath: toProjectPath('/bar.js'),
      type: 'js',
      isSource: true,
      stats,
      env: DEFAULT_ENV,
    });
    let barAssetNode = nodeFromAsset(db, barAsset.addr);

    graph.resolveAssetGroup(
      barAssetGroup,
      [{asset: barAsset.addr, dependencies: [barUtilsDep]}],
      '3',
    );
    graph.resolveDependency(barUtilsDep, utilsAssetGroup, '4');

    // bar undeferres utils
    graph.unmarkParentsWithHasDeferred(
      graph.getNodeIdByContentKey(utilsAssetGroupNode.id),
    );
    node = nullthrows(
      graph.getNodeByContentKey(Dependency.get(db, fooUtilsDep).id),
    );
    invariant(node.type === 'dependency');
    assert(!node.hasDeferred);
    node = nullthrows(graph.getNodeByContentKey(fooAssetNode.id));
    invariant(node.type === 'asset');
    assert(!node.hasDeferred);
    node = nullthrows(graph.getNodeByContentKey(fooAssetGroupNode.id));
    invariant(node.type === 'asset_group');
    assert(!node.hasDeferred);
    node = nullthrows(
      graph.getNodeByContentKey(Dependency.get(db, barUtilsDep).id),
    );
    invariant(node.type === 'dependency');
    assert(!node.hasDeferred);
    node = nullthrows(graph.getNodeByContentKey(barAssetNode.id));
    invariant(node.type === 'asset');
    assert(!node.hasDeferred);
    node = nullthrows(graph.getNodeByContentKey(barAssetGroupNode.id));
    invariant(node.type === 'asset_group');
    assert(!node.hasDeferred);
  });
});
