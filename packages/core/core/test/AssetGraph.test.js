// @flow

import assert from 'assert';
import AssetGraph, {nodeFromAssetGroup} from '../src/AssetGraph';
import Dependency from '../src/Dependency';
import Asset from '../src/Asset';
import Environment from '../src/Environment';
import tempy from 'tempy';
import Cache, {createCacheDir} from '@parcel/cache';
import {inputFS as fs, outputFS} from '@parcel/test-utils';

let cacheDir = tempy.directory();
createCacheDir(outputFS, cacheDir);
let cache = new Cache(outputFS, cacheDir);

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
    env: DEFAULT_ENV,
    publicUrl: null
  }
];

const stats = {size: 0, time: 0};

describe('AssetGraph', () => {
  it('initialization should create one root node with edges to dependency nodes for each entry', () => {
    let graph = new AssetGraph();
    graph.initialize({
      targets: TARGETS,
      entries: ['/path/to/index1', '/path/to/index2']
    });

    assert(graph.nodes.has('@@root'));
    assert(
      graph.nodes.has(
        new Dependency({
          moduleSpecifier: '/path/to/index1',
          env: DEFAULT_ENV
        }).id
      )
    );
    assert(
      graph.nodes.has(
        new Dependency({
          moduleSpecifier: '/path/to/index2',
          env: DEFAULT_ENV
        }).id
      )
    );
    assert.deepEqual(graph.getAllEdges(), [
      {
        from: '@@root',
        to: new Dependency({
          moduleSpecifier: '/path/to/index1',
          env: DEFAULT_ENV
        }).id,
        type: null
      },
      {
        from: '@@root',
        to: new Dependency({
          moduleSpecifier: '/path/to/index2',
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

    let dep = new Dependency({
      moduleSpecifier: '/path/to/index',
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

    let dep = new Dependency({
      moduleSpecifier: '/path/to/index',
      env: DEFAULT_ENV,
      sourcePath: ''
    });
    let filePath = '/index.js';
    let req = {filePath, env: DEFAULT_ENV};
    graph.resolveDependency(dep, req);
    let sourcePath = filePath;
    let assets = [
      new Asset({
        id: '1',
        fs,
        filePath,
        cache,
        type: 'js',
        hash: '#1',
        stats,
        dependencies: new Map([
          [
            'utils',
            new Dependency({
              moduleSpecifier: './utils',
              env: DEFAULT_ENV,
              sourcePath
            })
          ]
        ]),
        env: DEFAULT_ENV,
        connectedFiles: new Map()
      }),
      new Asset({
        id: '2',
        fs,
        filePath,
        type: 'js',
        cache,
        hash: '#2',
        stats,
        dependencies: new Map([
          [
            'styles',
            new Dependency({
              moduleSpecifier: './styles',
              env: DEFAULT_ENV,
              sourcePath
            })
          ]
        ]),
        env: DEFAULT_ENV,
        connectedFiles: new Map()
      }),
      new Asset({
        id: '3',
        fs,
        filePath,
        cache,
        type: 'js',
        hash: '#3',
        dependencies: new Map(),
        env: DEFAULT_ENV,
        stats,
        connectedFiles: new Map()
      })
    ];

    graph.resolveAssetGroup(req, assets);
    assert(graph.nodes.has('1'));
    assert(graph.nodes.has('2'));
    assert(graph.nodes.has('3'));
    assert(graph.nodes.has(assets[0].getDependencies()[0].id));
    assert(graph.nodes.has(assets[1].getDependencies()[0].id));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '1'));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '2'));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '3'));
    assert(graph.hasEdge('1', assets[0].getDependencies()[0].id));
    assert(graph.hasEdge('2', assets[1].getDependencies()[0].id));

    let assets2 = [
      new Asset({
        id: '1',
        fs,
        filePath,
        cache,
        type: 'js',
        hash: '#1',
        stats,
        dependencies: new Map([
          [
            'utils',
            new Dependency({
              moduleSpecifier: './utils',
              env: DEFAULT_ENV,
              sourcePath
            })
          ]
        ]),
        env: DEFAULT_ENV,
        connectedFiles: new Map()
      }),
      new Asset({
        id: '2',
        fs,
        filePath,
        cache,
        type: 'js',
        hash: '#2',
        stats,
        dependencies: new Map(),
        env: DEFAULT_ENV,
        connectedFiles: new Map()
      })
    ];

    graph.resolveAssetGroup(req, assets2);
    assert(graph.nodes.has('1'));
    assert(graph.nodes.has('2'));
    assert(!graph.nodes.has('3'));
    assert(graph.nodes.has(assets[0].getDependencies()[0].id));
    assert(!graph.nodes.has(assets[1].getDependencies()[0].id));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '1'));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '2'));
    assert(!graph.hasEdge(nodeFromAssetGroup(req).id, '3'));
    assert(graph.hasEdge('1', assets[0].getDependencies()[0].id));
    assert(!graph.hasEdge('2', assets[1].getDependencies()[0].id));
  });

  it('resolveAssetRequest should add connected file nodes', () => {
    let graph = new AssetGraph();
    graph.initialize({
      targets: TARGETS,
      entries: ['./index']
    });

    let dep = new Dependency({moduleSpecifier: './index', env: DEFAULT_ENV});
    let filePath = '/index.js';
    let req = {filePath, env: DEFAULT_ENV};
    graph.resolveDependency(dep, req);
    let sourcePath = filePath;
    let assets = [
      new Asset({
        id: '1',
        fs,
        filePath,
        cache,
        type: 'js',
        hash: '#1',
        stats,
        dependencies: new Map([
          [
            'utils',
            new Dependency({
              moduleSpecifier: './utils',
              env: DEFAULT_ENV,
              sourcePath
            })
          ]
        ]),
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

    graph.resolveAssetGroup(req, assets);
    assert(graph.nodes.has('1'));
    assert(graph.hasEdge(nodeFromAssetGroup(req).id, '1'));
  });
});
