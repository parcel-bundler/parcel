// @flow
'use strict';
import assert from 'assert';
import AssetGraph, {
  nodeFromFile,
  nodeFromTransformerRequest,
  nodeFromDep
} from '../src/AssetGraph';

const DEFAULT_ENV = {
  context: 'browser',
  engines: {
    browsers: ['> 1%']
  }
};

const TARGETS = [
  {
    distPath: 'dist/out.js',
    env: DEFAULT_ENV
  }
];

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
        nodeFromDep({
          sourcePath: '/index',
          moduleSpecifier: './index1',
          env: DEFAULT_ENV
        }).id
      )
    );
    assert(
      graph.nodes.has(
        nodeFromDep({
          sourcePath: '/index',
          moduleSpecifier: './index2',
          env: DEFAULT_ENV
        }).id
      )
    );
    assert.deepEqual(
      graph.edges,
      new Set([
        {
          from: '/',
          to: nodeFromDep({
            sourcePath: '/index',
            moduleSpecifier: './index1',
            env: DEFAULT_ENV
          }).id
        },
        {
          from: '/',
          to: nodeFromDep({
            sourcePath: '/index',
            moduleSpecifier: './index2',
            env: DEFAULT_ENV
          }).id
        }
      ])
    );
  });

  it('updateDependency should update the file a dependency is connected to', () => {
    let graph = new AssetGraph();
    graph.initializeGraph({
      targets: TARGETS,
      entries: ['./index'],
      rootDir: '/'
    });

    let dep = {
      sourcePath: '/index',
      moduleSpecifier: './index',
      env: DEFAULT_ENV
    };
    let req = {filePath: '/index.js', env: DEFAULT_ENV};

    graph.updateDependency(dep, req);
    assert(graph.nodes.has(nodeFromTransformerRequest(req).id));
    assert(
      graph.hasEdge({
        from: nodeFromDep(dep).id,
        to: nodeFromTransformerRequest(req).id
      })
    );
    assert(graph.incompleteNodes.has(nodeFromTransformerRequest(req).id));

    let req2 = {filePath: '/index.jsx', env: DEFAULT_ENV};
    graph.updateDependency(dep, req2);
    assert(!graph.nodes.has(nodeFromTransformerRequest(req).id));
    assert(graph.nodes.has(nodeFromTransformerRequest(req2).id));
    assert(
      graph.hasEdge({
        from: nodeFromDep(dep).id,
        to: nodeFromTransformerRequest(req2).id
      })
    );
    assert(
      !graph.hasEdge({
        from: nodeFromDep(dep).id,
        to: nodeFromTransformerRequest(req).id
      })
    );
    assert(graph.incompleteNodes.has(nodeFromTransformerRequest(req2).id));

    graph.updateDependency(dep, req2);
    assert(graph.nodes.has(nodeFromTransformerRequest(req2).id));
    assert(
      graph.hasEdge({
        from: nodeFromDep(dep).id,
        to: nodeFromTransformerRequest(req2).id
      })
    );
    assert(graph.incompleteNodes.has(nodeFromTransformerRequest(req2).id));
  });

  it('updateFile should update the asset and dep nodes a file is connected to', () => {
    let graph = new AssetGraph();
    graph.initializeGraph({
      targets: TARGETS,
      entries: ['./index'],
      rootDir: '/'
    });

    let dep = {
      sourcePath: '/index',
      moduleSpecifier: './index',
      env: DEFAULT_ENV
    };
    let filePath = '/index.js';
    let req = {filePath, env: DEFAULT_ENV};
    graph.updateDependency(dep, req);
    let sourcePath = filePath;
    let assets = [
      {
        id: '1',
        filePath,
        type: 'js',
        hash: '#1',
        dependencies: [{sourcePath, moduleSpecifier: './utils'}],
        env: DEFAULT_ENV,
        output: {code: ''},
        connectedFiles: []
      },
      {
        id: '2',
        filePath,
        type: 'js',
        hash: '#2',
        dependencies: [{sourcePath, moduleSpecifier: './styles'}],
        env: DEFAULT_ENV,
        output: {code: ''},
        connectedFiles: []
      },
      {
        id: '3',
        filePath,
        type: 'js',
        hash: '#3',
        dependencies: [],
        env: DEFAULT_ENV,
        output: {code: ''},
        connectedFiles: []
      }
    ];
    let cacheEntry = {
      filePath,
      env: DEFAULT_ENV,
      hash: '#hash',
      assets,
      initialAssets: null,
      connectedFiles: []
    };

    graph.updateFile(req, cacheEntry);
    assert(graph.nodes.has('1'));
    assert(graph.nodes.has('2'));
    assert(graph.nodes.has('3'));
    assert(graph.nodes.has(nodeFromDep(assets[0].dependencies[0]).id));
    assert(graph.nodes.has(nodeFromDep(assets[1].dependencies[0]).id));
    assert(graph.nodes.has('/index.js'));
    assert(
      graph.hasEdge({
        from: nodeFromTransformerRequest(req).id,
        to: '1'
      })
    );
    assert(
      graph.hasEdge({
        from: nodeFromTransformerRequest(req).id,
        to: '2'
      })
    );
    assert(
      graph.hasEdge({
        from: nodeFromTransformerRequest(req).id,
        to: '3'
      })
    );
    assert(
      graph.hasEdge({
        from: nodeFromTransformerRequest(req).id,
        to: filePath
      })
    );
    assert(
      graph.hasEdge({
        from: '1',
        to: nodeFromDep(assets[0].dependencies[0]).id
      })
    );
    assert(
      graph.hasEdge({
        from: '2',
        to: nodeFromDep(assets[1].dependencies[0]).id
      })
    );
    assert(!graph.incompleteNodes.has(nodeFromTransformerRequest(req).id));
    assert(
      graph.incompleteNodes.has(
        nodeFromDep({sourcePath, moduleSpecifier: './utils'}).id
      )
    );
    assert(
      graph.incompleteNodes.has(
        nodeFromDep({sourcePath, moduleSpecifier: './styles'}).id
      )
    );

    let assets2 = [
      {
        id: '1',
        filePath,
        type: 'js',
        hash: '#1',
        dependencies: [{sourcePath, moduleSpecifier: './utils'}],
        env: DEFAULT_ENV,
        output: {code: ''},
        connectedFiles: []
      },
      {
        id: '2',
        filePath,
        type: 'js',
        hash: '#2',
        dependencies: [],
        env: DEFAULT_ENV,
        output: {code: ''},
        connectedFiles: []
      }
    ];
    cacheEntry = {
      filePath,
      env: DEFAULT_ENV,
      hash: '#hash',
      assets: assets2,
      initialAssets: null,
      connectedFiles: []
    };

    graph.updateFile(req, cacheEntry);
    assert(graph.nodes.has('1'));
    assert(graph.nodes.has('2'));
    assert(!graph.nodes.has('3'));
    assert(graph.nodes.has(nodeFromDep(assets[0].dependencies[0]).id));
    assert(!graph.nodes.has(nodeFromDep(assets[1].dependencies[0]).id));
    assert(
      graph.hasEdge({
        from: nodeFromTransformerRequest(req).id,
        to: '1'
      })
    );
    assert(
      graph.hasEdge({
        from: nodeFromTransformerRequest(req).id,
        to: '2'
      })
    );
    assert(
      !graph.hasEdge({
        from: nodeFromTransformerRequest(req).id,
        to: '3'
      })
    );
    assert(
      graph.hasEdge({
        from: nodeFromTransformerRequest(req).id,
        to: filePath
      })
    );
    assert(
      graph.hasEdge({
        from: '1',
        to: nodeFromDep(assets[0].dependencies[0]).id
      })
    );
    assert(
      !graph.hasEdge({
        from: '2',
        to: nodeFromDep(assets[1].dependencies[0]).id
      })
    );
    assert(!graph.incompleteNodes.has(nodeFromTransformerRequest(req).id));
    assert(
      graph.incompleteNodes.has(
        nodeFromDep({sourcePath, moduleSpecifier: './utils'}).id
      )
    );
    assert(
      !graph.incompleteNodes.has(
        nodeFromDep({sourcePath, moduleSpecifier: './styles'}).id
      )
    );
  });

  it('updateFile should add connected file nodes', () => {
    let graph = new AssetGraph();
    graph.initializeGraph({
      targets: TARGETS,
      entries: ['./index'],
      rootDir: '/'
    });

    let dep = {sourcePath: '/', moduleSpecifier: './index', env: DEFAULT_ENV};
    let filePath = '/index.js';
    let req = {filePath, env: DEFAULT_ENV};
    graph.updateDependency(dep, req);
    let sourcePath = filePath;
    let assets = [
      {
        id: '1',
        filePath,
        type: 'js',
        hash: '#1',
        dependencies: [{sourcePath, moduleSpecifier: './utils'}],
        env: DEFAULT_ENV,
        output: {code: ''},
        connectedFiles: [
          {
            filePath: '/foo/bar'
          }
        ]
      }
    ];
    let cacheEntry = {
      filePath,
      env: DEFAULT_ENV,
      hash: '#hash',
      assets,
      initialAssets: null,
      connectedFiles: [
        {
          filePath: '/foo/baz'
        }
      ]
    };

    graph.updateFile(req, cacheEntry);
    assert(graph.nodes.has('1'));
    assert(graph.nodes.has('/foo/bar'));
    assert(graph.nodes.has('/foo/baz'));
    assert(graph.hasEdge({from: nodeFromTransformerRequest(req).id, to: '1'}));
    assert(
      graph.hasEdge({from: nodeFromTransformerRequest(req).id, to: '/foo/bar'})
    );
    assert(
      graph.hasEdge({from: nodeFromTransformerRequest(req).id, to: '/foo/baz'})
    );
  });
});
