// @flow

import assert from 'assert';
import AssetGraph, {nodeFromAssetGroup} from '../src/AssetGraph';
import {createDependency} from '../src/Dependency';
import {createAsset} from '../src/InternalAsset';
import {createEnvironment} from '../src/Environment';

const DEFAULT_ENV = createEnvironment({
  context: 'browser',
  engines: {
    browsers: ['> 1%']
  }
});

const TARGETS = [
  {
    name: 'test',
    distDir: 'dist',
    distEntry: 'out.js',
    env: DEFAULT_ENV,
    publicUrl: null
  }
];

const stats = {size: 0, time: 0};

describe('AssetGraph', () => {
  it('initialization should create one root node with edges to entry_specifier nodes for each entry', () => {
    let graph = new AssetGraph();
    graph.initialize({
      entries: ['/path/to/index1', '/path/to/index2']
    });

    assert(graph.nodes.has('@@root'));
    assert(graph.nodes.has('entry_specifier:/path/to/index1'));
    assert(graph.nodes.has('entry_specifier:/path/to/index2'));
  });

  it('resolveEntry should connect an entry_specifier node to entry_file nodes', () => {
    let graph = new AssetGraph();
    graph.initialize({
      entries: ['/path/to/index1', '/path/to/index2']
    });

    graph.resolveEntry('/path/to/index1', ['/path/to/index1/src/main.js']);

    assert(graph.nodes.has('entry_file:/path/to/index1/src/main.js'));
    assert(
      graph.hasEdge(
        'entry_specifier:/path/to/index1',
        'entry_file:/path/to/index1/src/main.js'
      )
    );
  });

  it('resolveTargets should connect an entry_file node to dependencies for each target', () => {
    let graph = new AssetGraph();
    graph.initialize({
      entries: ['/path/to/index1', '/path/to/index2']
    });

    graph.resolveEntry('/path/to/index1', ['/path/to/index1/src/main.js']);
    graph.resolveEntry('/path/to/index2', ['/path/to/index2/src/main.js']);

    graph.resolveTargets('/path/to/index1/src/main.js', TARGETS);
    graph.resolveTargets('/path/to/index2/src/main.js', TARGETS);

    assert(
      graph.nodes.has(
        createDependency({
          moduleSpecifier: '/path/to/index1/src/main.js',
          pipeline: 'test',
          target: TARGETS[0],
          env: DEFAULT_ENV
        }).id
      )
    );
    assert(
      graph.nodes.has(
        createDependency({
          moduleSpecifier: '/path/to/index2/src/main.js',
          pipeline: 'test',
          target: TARGETS[0],
          env: DEFAULT_ENV
        }).id
      )
    );
    assert.deepEqual(graph.getAllEdges(), [
      {
        from: '@@root',
        to: 'entry_specifier:/path/to/index1',
        type: null
      },
      {
        from: '@@root',
        to: 'entry_specifier:/path/to/index2',
        type: null
      },
      {
        from: 'entry_specifier:/path/to/index1',
        to: 'entry_file:/path/to/index1/src/main.js',
        type: null
      },
      {
        from: 'entry_specifier:/path/to/index2',
        to: 'entry_file:/path/to/index2/src/main.js',
        type: null
      },
      {
        from: 'entry_file:/path/to/index1/src/main.js',
        to: createDependency({
          moduleSpecifier: '/path/to/index1/src/main.js',
          pipeline: 'test',
          target: TARGETS[0],
          env: DEFAULT_ENV
        }).id,
        type: null
      },
      {
        from: 'entry_file:/path/to/index2/src/main.js',
        to: createDependency({
          moduleSpecifier: '/path/to/index2/src/main.js',
          pipeline: 'test',
          target: TARGETS[0],
          env: DEFAULT_ENV
        }).id,
        type: null
      }
    ]);
  });

  it('resolveDependency should update the file a dependency is connected to', () => {
    let graph = new AssetGraph();
    graph.initialize({
      targets: TARGETS,
      entries: ['/path/to/index']
    });

    graph.resolveEntry('/path/to/index', ['/path/to/index/src/main.js']);
    graph.resolveTargets('/path/to/index/src/main.js', TARGETS);

    let dep = createDependency({
      moduleSpecifier: '/path/to/index/src/main.js',
      pipeline: 'test',
      target: TARGETS[0],
      env: DEFAULT_ENV
    });
    let req = {filePath: '/index.js', env: DEFAULT_ENV};

    graph.resolveDependency(dep, req);
    assert(graph.nodes.has(nodeFromAssetGroup(req).id));
    assert(graph.hasEdge(dep.id, nodeFromAssetGroup(req).id));

    let req2 = {filePath: '/index.jsx', env: DEFAULT_ENV};
    graph.resolveDependency(dep, req2);
    assert(!graph.nodes.has(nodeFromAssetGroup(req).id));
    assert(graph.nodes.has(nodeFromAssetGroup(req2).id));
    assert(graph.hasEdge(dep.id, nodeFromAssetGroup(req2).id));
    assert(!graph.hasEdge(dep.id, nodeFromAssetGroup(req).id));

    graph.resolveDependency(dep, req2);
    assert(graph.nodes.has(nodeFromAssetGroup(req2).id));
    assert(graph.hasEdge(dep.id, nodeFromAssetGroup(req2).id));
  });

  it('resolveAssetGroup should update the asset and dep nodes a file is connected to', () => {
    let graph = new AssetGraph();
    graph.initialize({
      targets: TARGETS,
      entries: ['/path/to/index']
    });

    graph.resolveEntry('/path/to/index', ['/path/to/index/src/main.js']);
    graph.resolveTargets('/path/to/index/src/main.js', TARGETS);

    let dep = createDependency({
      moduleSpecifier: '/path/to/index/src/main.js',
      pipeline: 'test',
      target: TARGETS[0],
      env: DEFAULT_ENV,
      sourcePath: ''
    });
    let filePath = '/index.js';
    let req = {filePath, env: DEFAULT_ENV};
    graph.resolveDependency(dep, req);
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
              sourcePath
            })
          ]
        ]),
        env: DEFAULT_ENV,
        includedFiles: new Map()
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
              sourcePath
            })
          ]
        ]),
        env: DEFAULT_ENV,
        includedFiles: new Map()
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
        includedFiles: new Map()
      })
    ];

    graph.resolveAssetGroup(req, assets);
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
              sourcePath
            })
          ]
        ]),
        env: DEFAULT_ENV,
        includedFiles: new Map()
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
        includedFiles: new Map()
      })
    ];

    graph.resolveAssetGroup(req, assets2);
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

  it('resolveAssetRequest should add connected file nodes', () => {
    let graph = new AssetGraph();
    graph.initialize({
      targets: TARGETS,
      entries: ['./index']
    });

    graph.resolveEntry('./index', ['/path/to/index/src/main.js']);
    graph.resolveTargets('/path/to/index/src/main.js', TARGETS);

    let dep = createDependency({
      moduleSpecifier: '/path/to/index/src/main.js',
      pipeline: 'test',
      env: DEFAULT_ENV,
      target: TARGETS[0]
    });
    let filePath = '/index.js';
    let req = {filePath, env: DEFAULT_ENV};
    graph.resolveDependency(dep, req);
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
              sourcePath
            })
          ]
        ]),
        env: DEFAULT_ENV,
        includedFiles: new Map([
          [
            '/foo/bar',
            {
              filePath: '/foo/bar'
            }
          ]
        ])
      })
    ];

    graph.resolveAssetGroup(req, assets);
    assert(graph.nodes.has('1'));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '1'));
  });
});
