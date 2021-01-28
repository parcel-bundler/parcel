// @flow

import assert from 'assert';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import AssetGraph, {
  nodeFromAssetGroup,
  nodeFromDep,
  nodeFromEntryFile,
  nodeFromAsset,
} from '../src/AssetGraph';
import {createDependency} from '../src/Dependency';
import {createAsset} from '../src/assetUtils';
import {DEFAULT_ENV, DEFAULT_TARGETS} from './test-utils';

const stats = {size: 0, time: 0};

describe('AssetGraph', () => {
  it('initialization should create one root node with edges to entry_specifier nodes for each entry', () => {
    let graph = new AssetGraph();
    graph.setRootConnections({
      entries: ['/path/to/index1', '/path/to/index2'],
    });

    assert(graph.nodes.has('@@root'));
    assert(graph.nodes.has('entry_specifier:/path/to/index1'));
    assert(graph.nodes.has('entry_specifier:/path/to/index2'));
  });

  it('resolveEntry should connect an entry_specifier node to entry_file nodes', () => {
    let graph = new AssetGraph();
    graph.setRootConnections({
      entries: ['/path/to/index1', '/path/to/index2'],
    });

    graph.resolveEntry(
      '/path/to/index1',
      [
        {
          filePath: '/path/to/index1/src/main.js',
          packagePath: '/path/to/index1',
        },
      ],
      '123',
    );

    assert(
      graph.nodes.has(
        nodeFromEntryFile({
          filePath: '/path/to/index1/src/main.js',
          packagePath: '/path/to/index1',
        }).id,
      ),
    );
    assert(
      graph.hasEdge(
        'entry_specifier:/path/to/index1',
        nodeFromEntryFile({
          filePath: '/path/to/index1/src/main.js',
          packagePath: '/path/to/index1',
        }).id,
      ),
    );
  });

  it('resolveTargets should connect an entry_file node to dependencies for each target', () => {
    let graph = new AssetGraph();
    graph.setRootConnections({
      entries: ['/path/to/index1', '/path/to/index2'],
    });

    graph.resolveEntry(
      '/path/to/index1',
      [
        {
          filePath: '/path/to/index1/src/main.js',
          packagePath: '/path/to/index1',
        },
      ],
      '1',
    );
    graph.resolveEntry(
      '/path/to/index2',
      [
        {
          filePath: '/path/to/index2/src/main.js',
          packagePath: '/path/to/index2',
        },
      ],
      '2',
    );

    graph.resolveTargets(
      {filePath: '/path/to/index1/src/main.js', packagePath: '/path/to/index1'},
      DEFAULT_TARGETS,
      '3',
    );
    graph.resolveTargets(
      {filePath: '/path/to/index2/src/main.js', packagePath: '/path/to/index2'},
      DEFAULT_TARGETS,
      '4',
    );

    assert(
      graph.nodes.has(
        createDependency({
          moduleSpecifier: '/path/to/index1/src/main.js',
          target: DEFAULT_TARGETS[0],
          env: DEFAULT_ENV,
        }).id,
      ),
    );
    assert(
      graph.nodes.has(
        createDependency({
          moduleSpecifier: '/path/to/index2/src/main.js',
          target: DEFAULT_TARGETS[0],
          env: DEFAULT_ENV,
        }).id,
      ),
    );
    assert.deepEqual(graph.getAllEdges(), [
      {
        from: '@@root',
        to: 'entry_specifier:/path/to/index1',
        type: null,
      },
      {
        from: '@@root',
        to: 'entry_specifier:/path/to/index2',
        type: null,
      },
      {
        from: 'entry_specifier:/path/to/index1',
        to: nodeFromEntryFile({
          filePath: '/path/to/index1/src/main.js',
          packagePath: '/path/to/index1',
        }).id,
        type: null,
      },
      {
        from: 'entry_specifier:/path/to/index2',
        to: nodeFromEntryFile({
          filePath: '/path/to/index2/src/main.js',
          packagePath: '/path/to/index2',
        }).id,
        type: null,
      },
      {
        from: nodeFromEntryFile({
          filePath: '/path/to/index1/src/main.js',
          packagePath: '/path/to/index1',
        }).id,
        to: createDependency({
          moduleSpecifier: '/path/to/index1/src/main.js',
          target: DEFAULT_TARGETS[0],
          env: DEFAULT_ENV,
        }).id,
        type: null,
      },
      {
        from: nodeFromEntryFile({
          filePath: '/path/to/index2/src/main.js',
          packagePath: '/path/to/index2',
        }).id,
        to: createDependency({
          moduleSpecifier: '/path/to/index2/src/main.js',
          target: DEFAULT_TARGETS[0],
          env: DEFAULT_ENV,
        }).id,
        type: null,
      },
    ]);
  });

  it('resolveDependency should update the file a dependency is connected to', () => {
    let graph = new AssetGraph();
    graph.setRootConnections({
      targets: DEFAULT_TARGETS,
      entries: ['/path/to/index'],
    });

    graph.resolveEntry(
      '/path/to/index',
      [{filePath: '/path/to/index/src/main.js', packagePath: '/path/to/index'}],
      '1',
    );
    graph.resolveTargets(
      {filePath: '/path/to/index/src/main.js', packagePath: '/path/to/index'},
      DEFAULT_TARGETS,
      '2',
    );

    let dep = createDependency({
      moduleSpecifier: '/path/to/index/src/main.js',
      target: DEFAULT_TARGETS[0],
      env: DEFAULT_ENV,
    });
    let req = {filePath: '/index.js', env: DEFAULT_ENV, query: {}};

    graph.resolveDependency(dep, req, '3');
    assert(graph.nodes.has(nodeFromAssetGroup(req).id));
    assert(graph.hasEdge(dep.id, nodeFromAssetGroup(req).id));

    let req2 = {filePath: '/index.jsx', env: DEFAULT_ENV, query: {}};
    graph.resolveDependency(dep, req2, '4');
    assert(!graph.nodes.has(nodeFromAssetGroup(req).id));
    assert(graph.nodes.has(nodeFromAssetGroup(req2).id));
    assert(graph.hasEdge(dep.id, nodeFromAssetGroup(req2).id));
    assert(!graph.hasEdge(dep.id, nodeFromAssetGroup(req).id));

    graph.resolveDependency(dep, req2, '5');
    assert(graph.nodes.has(nodeFromAssetGroup(req2).id));
    assert(graph.hasEdge(dep.id, nodeFromAssetGroup(req2).id));
  });

  it('resolveAssetGroup should update the asset and dep nodes a file is connected to', () => {
    let graph = new AssetGraph();
    graph.setRootConnections({
      targets: DEFAULT_TARGETS,
      entries: ['/path/to/index'],
    });

    graph.resolveEntry(
      '/path/to/index',
      [{filePath: '/path/to/index/src/main.js', packagePath: '/path/to/index'}],
      '1',
    );
    graph.resolveTargets(
      {filePath: '/path/to/index/src/main.js', packagePath: '/path/to/index'},
      DEFAULT_TARGETS,
      '2',
    );

    let dep = createDependency({
      moduleSpecifier: '/path/to/index/src/main.js',
      target: DEFAULT_TARGETS[0],
      env: DEFAULT_ENV,
      sourcePath: '',
    });
    let filePath = '/index.js';
    let req = {filePath, env: DEFAULT_ENV, query: {}};
    graph.resolveDependency(dep, req, '3');
    let sourcePath = filePath;
    let assets = [
      createAsset({
        id: '1',
        filePath,
        type: 'js',
        isSource: true,
        hash: '#1',
        stats,
        dependencies: new Map([
          [
            'utils',
            createDependency({
              moduleSpecifier: './utils',
              env: DEFAULT_ENV,
              sourcePath,
            }),
          ],
        ]),
        env: DEFAULT_ENV,
      }),
      createAsset({
        id: '2',
        filePath,
        type: 'js',
        isSource: true,
        hash: '#2',
        stats,
        dependencies: new Map([
          [
            'styles',
            createDependency({
              moduleSpecifier: './styles',
              env: DEFAULT_ENV,
              sourcePath,
            }),
          ],
        ]),
        env: DEFAULT_ENV,
      }),
      createAsset({
        id: '3',
        filePath,
        type: 'js',
        isSource: true,
        hash: '#3',
        dependencies: new Map(),
        env: DEFAULT_ENV,
        stats,
      }),
    ];

    graph.resolveAssetGroup(req, assets, '4');
    assert(graph.nodes.has('1'));
    assert(graph.nodes.has('2'));
    assert(graph.nodes.has('3'));
    assert(graph.nodes.has([...assets[0].dependencies.values()][0].id));
    assert(graph.nodes.has([...assets[1].dependencies.values()][0].id));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '1'));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '2'));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '3'));
    assert(graph.hasEdge('1', [...assets[0].dependencies.values()][0].id));
    assert(graph.hasEdge('2', [...assets[1].dependencies.values()][0].id));

    let assets2 = [
      createAsset({
        id: '1',
        filePath,
        type: 'js',
        isSource: true,
        hash: '#1',
        stats,
        dependencies: new Map([
          [
            'utils',
            createDependency({
              moduleSpecifier: './utils',
              env: DEFAULT_ENV,
              sourcePath,
            }),
          ],
        ]),
        env: DEFAULT_ENV,
      }),
      createAsset({
        id: '2',
        filePath,
        type: 'js',
        isSource: true,
        hash: '#2',
        stats,
        dependencies: new Map(),
        env: DEFAULT_ENV,
      }),
    ];

    graph.resolveAssetGroup(req, assets2, '5');
    assert(graph.nodes.has('1'));
    assert(graph.nodes.has('2'));
    assert(!graph.nodes.has('3'));
    assert(graph.nodes.has([...assets[0].dependencies.values()][0].id));
    assert(!graph.nodes.has([...assets[1].dependencies.values()][0].id));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '1'));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '2'));
    assert(!graph.hasEdge(nodeFromAssetGroup(req).id, '3'));
    assert(graph.hasEdge('1', [...assets[0].dependencies.values()][0].id));
    assert(!graph.hasEdge('2', [...assets[1].dependencies.values()][0].id));
  });

  // Assets can define dependent assets in the same asset group by declaring a dependency with a module
  // specifer that matches the dependent asset's unique key. These dependent assets are then connected
  // to the asset's dependency instead of the asset group.
  it('resolveAssetGroup should handle dependent assets in asset groups', () => {
    let graph = new AssetGraph();
    graph.setRootConnections({targets: DEFAULT_TARGETS, entries: ['./index']});

    graph.resolveEntry(
      './index',
      [{filePath: '/path/to/index/src/main.js', packagePath: '/path/to/index'}],
      '1',
    );
    graph.resolveTargets(
      {filePath: '/path/to/index/src/main.js', packagePath: '/path/to/index'},
      DEFAULT_TARGETS,
      '2',
    );

    let dep = createDependency({
      moduleSpecifier: '/path/to/index/src/main.js',
      env: DEFAULT_ENV,
      target: DEFAULT_TARGETS[0],
    });
    let filePath = '/index.js';
    let req = {filePath, env: DEFAULT_ENV, query: {}};
    graph.resolveDependency(dep, req, '123');
    let sourcePath = filePath;
    let dep1 = createDependency({
      moduleSpecifier: 'dependent-asset-1',
      env: DEFAULT_ENV,
      sourcePath,
    });
    let dep2 = createDependency({
      moduleSpecifier: 'dependent-asset-2',
      env: DEFAULT_ENV,
      sourcePath,
    });
    let assets = [
      createAsset({
        id: '1',
        filePath,
        type: 'js',
        isSource: true,
        hash: '#1',
        stats,
        dependencies: new Map([['dep1', dep1]]),
        env: DEFAULT_ENV,
      }),
      createAsset({
        id: '2',
        uniqueKey: 'dependent-asset-1',
        filePath,
        type: 'js',
        isSource: true,
        hash: '#1',
        stats,
        dependencies: new Map([['dep2', dep2]]),
        env: DEFAULT_ENV,
      }),
      createAsset({
        id: '3',
        uniqueKey: 'dependent-asset-2',
        filePath,
        type: 'js',
        isSource: true,
        hash: '#1',
        stats,
        env: DEFAULT_ENV,
      }),
    ];

    graph.resolveAssetGroup(req, assets, '3');
    assert(graph.nodes.has('1'));
    assert(graph.nodes.has('2'));
    assert(graph.nodes.has('3'));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '1'));
    assert(!graph.hasEdge(nodeFromAssetGroup(req).id, '2'));
    assert(!graph.hasEdge(nodeFromAssetGroup(req).id, '3'));
    assert(graph.hasEdge('1', nodeFromDep(dep1).id));
    assert(graph.hasEdge(nodeFromDep(dep1).id, '2'));
    assert(graph.hasEdge('2', nodeFromDep(dep2).id));
    assert(graph.hasEdge(nodeFromDep(dep2).id, '3'));
  });

  it('should support marking and unmarking all parents with hasDeferred', () => {
    let graph = new AssetGraph();

    // index
    let indexAssetGroup = {filePath: '/index.js', env: DEFAULT_ENV, query: {}};
    graph.setRootConnections({assetGroups: [indexAssetGroup]});
    let indexFooDep = createDependency({
      moduleSpecifier: './foo',
      env: DEFAULT_ENV,
      sourcePath: '/index.js',
    });
    let indexBarDep = createDependency({
      moduleSpecifier: './bar',
      env: DEFAULT_ENV,
      sourcePath: '/index.js',
    });
    let indexAsset = createAsset({
      id: 'assetIndex',
      filePath: '/index.js',
      type: 'js',
      isSource: true,
      hash: '#4',
      stats,
      dependencies: new Map([
        ['./foo', indexFooDep],
        ['./bar', indexBarDep],
      ]),
      env: DEFAULT_ENV,
    });
    graph.resolveAssetGroup(indexAssetGroup, [indexAsset], '0');

    // index imports foo
    let fooAssetGroup = {filePath: '/foo.js', env: DEFAULT_ENV, query: {}};
    graph.resolveDependency(indexFooDep, fooAssetGroup, '0');
    let fooAssetGroupNode = nodeFromAssetGroup(fooAssetGroup);
    let fooUtilsDep = createDependency({
      moduleSpecifier: './utils',
      env: DEFAULT_ENV,
      sourcePath: '/foo.js',
    });
    let fooUtilsDepNode = nodeFromDep(fooUtilsDep);
    let fooAsset = createAsset({
      id: 'assetFoo',
      filePath: '/foo.js',
      type: 'js',
      isSource: true,
      hash: '#1',
      stats,
      dependencies: new Map([['./utils', fooUtilsDep]]),
      env: DEFAULT_ENV,
    });
    let fooAssetNode = nodeFromAsset(fooAsset);
    graph.resolveAssetGroup(fooAssetGroup, [fooAsset], '0');
    let utilsAssetGroup = {filePath: '/utils.js', env: DEFAULT_ENV, query: {}};
    let utilsAssetGroupNode = nodeFromAssetGroup(utilsAssetGroup);
    graph.resolveDependency(fooUtilsDep, utilsAssetGroup, '0');

    // foo's dependency is deferred
    graph.markParentsWithHasDeferred(fooUtilsDepNode);
    let node = nullthrows(graph.getNode(fooAssetNode.id));
    invariant(node.type === 'asset');
    assert(node.hasDeferred);
    node = nullthrows(graph.getNode(fooAssetGroupNode.id));
    invariant(node.type === 'asset_group');
    assert(node.hasDeferred);

    // index also imports bar
    let barAssetGroup = {filePath: '/bar.js', env: DEFAULT_ENV, query: {}};
    graph.resolveDependency(indexBarDep, barAssetGroup, '0');
    let barAssetGroupNode = nodeFromAssetGroup(barAssetGroup);
    let barUtilsDep = createDependency({
      moduleSpecifier: './utils',
      env: DEFAULT_ENV,
      sourcePath: '/bar.js',
    });
    let barAsset = createAsset({
      id: 'assetBar',
      filePath: '/bar.js',
      type: 'js',
      isSource: true,
      hash: '#2',
      stats,
      dependencies: new Map([['./utils', barUtilsDep]]),
      env: DEFAULT_ENV,
    });
    let barAssetNode = nodeFromAsset(barAsset);
    graph.resolveAssetGroup(barAssetGroup, [barAsset], '3');
    graph.resolveDependency(barUtilsDep, utilsAssetGroup, '4');

    // bar undeferres utils
    graph.unmarkParentsWithHasDeferred(utilsAssetGroupNode);
    node = nullthrows(graph.getNode(fooUtilsDep.id));
    invariant(node.type === 'dependency');
    assert(!node.hasDeferred);
    node = nullthrows(graph.getNode(fooAssetNode.id));
    invariant(node.type === 'asset');
    assert(!node.hasDeferred);
    node = nullthrows(graph.getNode(fooAssetGroupNode.id));
    invariant(node.type === 'asset_group');
    assert(!node.hasDeferred);
    node = nullthrows(graph.getNode(barUtilsDep.id));
    invariant(node.type === 'dependency');
    assert(!node.hasDeferred);
    node = nullthrows(graph.getNode(barAssetNode.id));
    invariant(node.type === 'asset');
    assert(!node.hasDeferred);
    node = nullthrows(graph.getNode(barAssetGroupNode.id));
    invariant(node.type === 'asset_group');
    assert(!node.hasDeferred);
  });
});
