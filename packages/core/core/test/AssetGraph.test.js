// @flow

import assert from 'assert';
import AssetGraph, {nodeFromTransformerRequest} from '../src/AssetGraph';
import Dependency from '../src/Dependency';
import Asset from '../src/Asset';
import Environment from '../src/Environment';

const DEFAULT_ENV = new Environment({
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
    env: DEFAULT_ENV
  }
];

const stats = {size: 0, time: 0};

describe('AssetGraph', () => {
  it('initialization should create one root node with edges to dependency nodes for each entry', () => {
    let graph = new AssetGraph();
    graph.initializeGraph({
      targets: TARGETS,
      entries: ['./index1', './index2'],
      rootDir: '/'
    });

    assert(graph.nodes.has('/'));
    assert(
      graph.nodes.has(
        new Dependency({
          moduleSpecifier: './index1',
          env: DEFAULT_ENV
        }).id
      )
    );
    assert(
      graph.nodes.has(
        new Dependency({
          moduleSpecifier: './index2',
          env: DEFAULT_ENV
        }).id
      )
    );
    assert.deepEqual(graph.getAllEdges(), [
      {
        from: '/',
        to: new Dependency({
          moduleSpecifier: './index1',
          env: DEFAULT_ENV
        }).id
      },
      {
        from: '/',
        to: new Dependency({
          moduleSpecifier: './index2',
          env: DEFAULT_ENV
        }).id
      }
    ]);
  });

  it('resolveDependency should update the file a dependency is connected to', () => {
    let graph = new AssetGraph();
    graph.initializeGraph({
      targets: TARGETS,
      entries: ['./index'],
      rootDir: '/'
    });

    let dep = new Dependency({
      moduleSpecifier: './index',
      env: DEFAULT_ENV,
      sourcePath: '/index'
    });
    let req = {filePath: '/index.js', env: DEFAULT_ENV};

    graph.resolveDependency(dep, req);
    assert(graph.nodes.has(nodeFromTransformerRequest(req).id));
    assert(graph.hasEdge(dep.id, nodeFromTransformerRequest(req).id));
    assert(graph.incompleteNodes.has(nodeFromTransformerRequest(req).id));

    let req2 = {filePath: '/index.jsx', env: DEFAULT_ENV};
    graph.resolveDependency(dep, req2);
    assert(!graph.nodes.has(nodeFromTransformerRequest(req).id));
    assert(graph.nodes.has(nodeFromTransformerRequest(req2).id));
    assert(graph.hasEdge(dep.id, nodeFromTransformerRequest(req2).id));
    assert(!graph.hasEdge(dep.id, nodeFromTransformerRequest(req).id));
    assert(graph.incompleteNodes.has(nodeFromTransformerRequest(req2).id));

    graph.resolveDependency(dep, req2);
    assert(graph.nodes.has(nodeFromTransformerRequest(req2).id));
    assert(graph.hasEdge(dep.id, nodeFromTransformerRequest(req2).id));
    assert(graph.incompleteNodes.has(nodeFromTransformerRequest(req2).id));
  });

  it('resolveTransformerRequest should update the asset and dep nodes a file is connected to', () => {
    let graph = new AssetGraph();
    graph.initializeGraph({
      targets: TARGETS,
      entries: ['./index'],
      rootDir: '/'
    });

    let dep = new Dependency({
      moduleSpecifier: './index',
      env: DEFAULT_ENV,
      sourcePath: '/index'
    });
    let filePath = '/index.js';
    let req = {filePath, env: DEFAULT_ENV};
    graph.resolveDependency(dep, req);
    let sourcePath = filePath;
    let assets = [
      new Asset({
        id: '1',
        filePath,
        type: 'js',
        hash: '#1',
        stats,
        dependencies: [
          [
            'utils',
            new Dependency({
              moduleSpecifier: './utils',
              env: DEFAULT_ENV,
              sourcePath
            })
          ]
        ],
        env: DEFAULT_ENV,
        connectedFiles: []
      }),
      new Asset({
        id: '2',
        filePath,
        type: 'js',
        hash: '#2',
        stats,
        dependencies: [
          [
            'styles',
            new Dependency({
              moduleSpecifier: './styles',
              env: DEFAULT_ENV,
              sourcePath
            })
          ]
        ],
        env: DEFAULT_ENV,
        connectedFiles: []
      }),
      new Asset({
        id: '3',
        filePath,
        type: 'js',
        hash: '#3',
        dependencies: [],
        env: DEFAULT_ENV,
        stats,
        connectedFiles: []
      })
    ];
    let cacheEntry = {
      filePath,
      env: DEFAULT_ENV,
      hash: '#hash',
      assets,
      initialAssets: null,
      connectedFiles: []
    };

    graph.resolveTransformerRequest(req, cacheEntry);
    assert(graph.nodes.has('1'));
    assert(graph.nodes.has('2'));
    assert(graph.nodes.has('3'));
    assert(graph.nodes.has(assets[0].getDependencies()[0].id));
    assert(graph.nodes.has(assets[1].getDependencies()[0].id));
    assert(graph.nodes.has('/index.js'));
    assert(graph.hasEdge(nodeFromTransformerRequest(req).id, '1'));
    assert(graph.hasEdge(nodeFromTransformerRequest(req).id, '2'));
    assert(graph.hasEdge(nodeFromTransformerRequest(req).id, '3'));
    assert(graph.hasEdge(nodeFromTransformerRequest(req).id, filePath));
    assert(graph.hasEdge('1', assets[0].getDependencies()[0].id));
    assert(graph.hasEdge('2', assets[1].getDependencies()[0].id));
    assert(!graph.incompleteNodes.has(nodeFromTransformerRequest(req).id));
    assert(
      graph.incompleteNodes.has(
        new Dependency({
          moduleSpecifier: './utils',
          env: DEFAULT_ENV,
          sourcePath
        }).id
      )
    );
    assert(
      graph.incompleteNodes.has(
        new Dependency({
          moduleSpecifier: './styles',
          env: DEFAULT_ENV,
          sourcePath
        }).id
      )
    );

    let assets2 = [
      new Asset({
        id: '1',
        filePath,
        type: 'js',
        hash: '#1',
        stats,
        dependencies: [
          [
            'utils',
            new Dependency({
              moduleSpecifier: './utils',
              env: DEFAULT_ENV,
              sourcePath
            })
          ]
        ],
        env: DEFAULT_ENV,
        connectedFiles: []
      }),
      new Asset({
        id: '2',
        filePath,
        type: 'js',
        hash: '#2',
        stats,
        dependencies: [],
        env: DEFAULT_ENV,
        connectedFiles: []
      })
    ];
    cacheEntry = {
      filePath,
      env: DEFAULT_ENV,
      hash: '#hash',
      assets: assets2,
      initialAssets: null,
      connectedFiles: []
    };

    graph.resolveTransformerRequest(req, cacheEntry);
    assert(graph.nodes.has('1'));
    assert(graph.nodes.has('2'));
    assert(!graph.nodes.has('3'));
    assert(graph.nodes.has(assets[0].getDependencies()[0].id));
    assert(!graph.nodes.has(assets[1].getDependencies()[0].id));
    assert(graph.hasEdge(nodeFromTransformerRequest(req).id, '1'));
    assert(graph.hasEdge(nodeFromTransformerRequest(req).id, '2'));
    assert(!graph.hasEdge(nodeFromTransformerRequest(req).id, '3'));
    assert(graph.hasEdge(nodeFromTransformerRequest(req).id, filePath));
    assert(graph.hasEdge('1', assets[0].getDependencies()[0].id));
    assert(!graph.hasEdge('2', assets[1].getDependencies()[0].id));
    assert(!graph.incompleteNodes.has(nodeFromTransformerRequest(req).id));
    assert(
      graph.incompleteNodes.has(
        new Dependency({
          moduleSpecifier: './utils',
          env: DEFAULT_ENV,
          sourcePath
        }).id
      )
    );
    assert(
      !graph.incompleteNodes.has(
        new Dependency({
          moduleSpecifier: './styles',
          env: DEFAULT_ENV,
          sourcePath
        }).id
      )
    );
  });

  it('resolveTransformerRequest should add connected file nodes', () => {
    let graph = new AssetGraph();
    graph.initializeGraph({
      targets: TARGETS,
      entries: ['./index'],
      rootDir: '/'
    });

    let dep = new Dependency({moduleSpecifier: './index', env: DEFAULT_ENV});
    let filePath = '/index.js';
    let req = {filePath, env: DEFAULT_ENV};
    graph.resolveDependency(dep, req);
    let sourcePath = filePath;
    let assets = [
      new Asset({
        id: '1',
        filePath,
        type: 'js',
        hash: '#1',
        stats,
        dependencies: [
          [
            'utils',
            new Dependency({
              moduleSpecifier: './utils',
              env: DEFAULT_ENV,
              sourcePath
            })
          ]
        ],
        env: DEFAULT_ENV,
        connectedFiles: new Map([
          [
            '/foo/bar',
            {
              filePath: '/foo/bar'
            }
          ]
        ])
      })
    ];
    let cacheEntry = {
      filePath,
      env: DEFAULT_ENV,
      hash: '#hash',
      assets,
      initialAssets: null
    };

    graph.resolveTransformerRequest(req, cacheEntry);
    assert(graph.nodes.has('1'));
    assert(graph.nodes.has('/foo/bar'));
    assert(graph.hasEdge(nodeFromTransformerRequest(req).id, '1'));
    assert(graph.hasEdge(nodeFromTransformerRequest(req).id, '/foo/bar'));
  });
});
