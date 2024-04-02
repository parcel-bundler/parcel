// @flow strict-local
import assert from 'assert';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import type {FilePath, SourceLocation, Meta, Symbol} from '@parcel/types';
import type {NodeId} from '@parcel/graph';
import type {Diagnostic} from '@parcel/diagnostic';
import ThrowableDiagnostic from '@parcel/diagnostic';
import {setEqual} from '@parcel/utils';
import AssetGraph, {
  nodeFromAssetGroup,
  nodeFromDep,
  nodeFromEntryFile,
  nodeFromAsset,
} from '../src/AssetGraph';
import {createDependency as _createDependency} from '../src/Dependency';
import {createAsset as _createAsset} from '../src/assetUtils';
import {
  toProjectPath as _toProjectPath,
  type ProjectPath,
} from '../src/projectPath';
import {propagateSymbols} from '../src/SymbolPropagation';
import dumpGraphToGraphViz from '../src/dumpGraphToGraphViz';
import {DEFAULT_ENV, DEFAULT_OPTIONS, DEFAULT_TARGETS, DB} from './test-utils';
import type {AssetNode, AssetGraphNode, DependencyNode} from '../src/types';
import {
  Asset,
  type AssetAddr,
  Dependency,
  DependencyFlags,
  SymbolFlags,
} from '@parcel/rust';
import {
  MutableDependencySymbols,
  MutableAssetSymbols,
} from '../src/public/Symbols';

const stats = {size: 0, time: 0};

function createAsset(opts) {
  return _createAsset(DB, '/', opts).addr;
}

function createDependency(opts) {
  return _createDependency(DB, '/', opts);
}

function toProjectPath(p) {
  return _toProjectPath('/', p);
}

function fromProjectPathUnix(p: ProjectPath) {
  // $FlowFixMe
  return '/' + p;
}

function nullthrowsAssetNode(v: ?AssetGraphNode): AssetNode {
  invariant(v?.type === 'asset');
  return v;
}
function nullthrowsDependencyNode(v: ?AssetGraphNode): DependencyNode {
  invariant(v?.type === 'dependency');
  return v;
}

function createAssetGraph(
  assets: Array<
    [
      FilePath,
      /* symbols (or cleared) */ ?Array<
        [Symbol, {|local: Symbol, loc?: ?SourceLocation, meta?: ?Meta|}],
      >,
      /* sideEffects */ boolean,
    ],
  >,
  dependencies: Array<
    [
      /* from */ FilePath,
      /* to */ FilePath,
      /* symbols (or cleared) */ ?Array<
        [
          Symbol,
          {|
            local: Symbol,
            loc?: ?SourceLocation,
            isWeak: boolean,
            meta?: ?Meta,
          |},
        ],
      >,
    ],
  >,
  isLibrary?: boolean,
) {
  let graph = new AssetGraph(DB);
  let entryFilePath = '/index.js';
  graph.setRootConnections({
    entries: [toProjectPath(entryFilePath)],
  });
  let entry = {
    filePath: toProjectPath(entryFilePath),
    packagePath: toProjectPath('/'),
  };
  let entryNodeContentKey = nodeFromEntryFile(entry).id;
  graph.resolveEntry(toProjectPath(entryFilePath), [entry], '1');
  graph.resolveTargets(entry, DEFAULT_TARGETS, '2');
  let entryDependencyId = graph.getNodeIdsConnectedFrom(
    graph.getNodeIdByContentKey(entryNodeContentKey),
  )[0];
  if (isLibrary) {
    let entryDependencyNode = nullthrows(graph.getNode(entryDependencyId));
    invariant(entryDependencyNode.type === 'dependency');
    let entryDep = Dependency.get(DB, entryDependencyNode.value);
    let s = entryDep.symbols.extend();
    s.exported = DB.starSymbol;
    s.local = DB.starSymbol;
    s.flags = SymbolFlags.IS_WEAK;
    s.loc = null;
    entryDep.flags |= DependencyFlags.HAS_SYMBOLS;
    entryDependencyNode.usedSymbolsDown.add(DB.starSymbol);
    entryDependencyNode.usedSymbolsUp.set(DB.starSymbol, undefined);
  }

  let assetId = 1;
  let changedAssets = new Map();
  let assetGroupNodes = new Map<FilePath, NodeId>();
  let assetNodes = new Map<FilePath, NodeId>();
  let assetAddrs = new Map<FilePath, AssetAddr>();
  for (let [filePath, symbols, sideEffects] of assets) {
    let assetGroup = nodeFromAssetGroup({
      filePath: toProjectPath(filePath),
      env: DEFAULT_ENV,
      sideEffects,
    });
    let assetGroupNodeId = graph.addNodeByContentKey(assetGroup.id, assetGroup);
    assetGroupNodes.set(filePath, assetGroupNodeId);

    let asset = nodeFromAsset(
      DB,
      createAsset({
        id: String(assetId),
        filePath: toProjectPath(filePath),
        type: 'js',
        isSource: true,
        sideEffects,
        stats,
        symbols: symbols ? new Map(symbols) : symbols,
        env: DEFAULT_ENV,
      }),
    );
    let assetNodeId = graph.addNodeByContentKey(asset.id, asset);
    assetNodes.set(filePath, assetNodeId);
    changedAssets.set(asset.value, asset.value);
    assetAddrs.set(filePath, asset.value);

    graph.addEdge(assetGroupNodeId, assetNodeId);

    assetId++;
  }

  for (let [from, to, symbols] of dependencies) {
    let dependencyNode = nodeFromDep(
      DB,
      createDependency({
        specifier: to,
        specifierType: 'esm',
        env: DEFAULT_ENV,
        symbols: symbols ? new Map(symbols) : symbols,
        sourceAssetId: assetAddrs.get(from),
      }),
    );
    let dependencyNodeId = graph.addNodeByContentKey(
      dependencyNode.id,
      dependencyNode,
    );
    graph.addEdge(nullthrows(assetNodes.get(from)), dependencyNodeId);
    graph.addEdge(dependencyNodeId, nullthrows(assetGroupNodes.get(to)));
  }

  let entryAssetGroup = nullthrows(assetGroupNodes.get(entryFilePath));
  graph.addEdge(entryDependencyId, entryAssetGroup);

  return {graph, changedAssets};
}

function assertUsedSymbols(
  graph: AssetGraph,
  _expectedAsset: Array<[FilePath, /* usedSymbols */ Array<Symbol>]>,
  _expectedDependency: Array<
    [
      FilePath,
      FilePath,
      /* usedSymbols */ Array<[Symbol, ?[FilePath, ?Symbol]] | [Symbol]> | null,
    ],
  >,
  isLibrary?: boolean,
) {
  let expectedAsset = new Map(
    _expectedAsset.map(([f, symbols]) => [f, symbols]),
  );
  let expectedDependency = new Map(
    _expectedDependency.map(([from, to, sym]) => [
      from + ':' + to,
      // $FlowFixMe[invalid-tuple-index]
      sym ? sym.map(v => [v[0], v[1] ?? [to, v[0]]]) : sym,
    ]),
  );

  if (isLibrary) {
    let entryDep = nullthrows(
      [...graph.nodes.values()].find(
        n =>
          n?.type === 'dependency' &&
          Dependency.get(DB, n.value).sourceAssetId == null,
      ),
    );
    invariant(entryDep.type === 'dependency');
    assertDependencyUsedSymbols(
      entryDep.usedSymbolsUp,
      new Map([['*', undefined]]),
      'entryDep',
    );
  }

  function assertDependencyUsedSymbols(usedSymbolsUp, expectedMap, id) {
    assertSetEqual(
      readSymbolSet(new Set(usedSymbolsUp.keys())),
      new Set(expectedMap.keys()),
      id,
    );

    for (let [s, resolved] of usedSymbolsUp) {
      let exp = expectedMap.get(DB.readString(s));
      if (resolved && exp) {
        let assetNode = nullthrows(graph.getNodeByContentKey(resolved.asset));
        invariant(assetNode.type === 'asset');
        let asset = Asset.get(DB, assetNode.value);
        assert.strictEqual(
          fromProjectPathUnix(asset.filePath),
          exp[0],
          `dep ${id}@${s} resolved asset: ${fromProjectPathUnix(
            asset.filePath,
          )} !== ${exp[0]}`,
        );
        assert.strictEqual(
          DB.readString(nullthrows(resolved.symbol)),
          exp[1],
          `dep ${id}@${s} resolved symbol: ${String(
            DB.readString(nullthrows(resolved.symbol)),
          )} !== ${String(exp[1])}`,
        );
      } else {
        assert.equal(resolved, exp);
      }
    }
  }

  for (let [nodeId, node] of graph.nodes.entries()) {
    if (node?.type === 'asset') {
      let asset = Asset.get(DB, node.value);
      let filePath = fromProjectPathUnix(asset.filePath);
      let expected = new Set(nullthrows(expectedAsset.get(filePath)));
      assertSetEqual(readSymbolSet(node.usedSymbols), expected, filePath);
    } else if (
      node?.type === 'dependency' &&
      Dependency.get(DB, node.value).sourceAssetId != null
    ) {
      let dep = Dependency.get(DB, node.value);
      let resolutionId = graph.getNodeIdsConnectedFrom(nodeId)[0];
      let resolution = nullthrows(graph.getNode(resolutionId));
      invariant(resolution.type === 'asset_group');
      let to = resolution.value.filePath;

      let id =
        fromProjectPathUnix(
          nullthrows(Asset.get(DB, nullthrows(dep.sourceAssetId)).filePath),
        ) +
        ':' +
        fromProjectPathUnix(nullthrows(to));
      let expected = expectedDependency.get(id);
      if (!expected) {
        assert(expected === null);
        assertSetEqual(
          readSymbolSet(new Set(node.usedSymbolsUp.keys())),
          new Set(),
          id,
        );
        assert(node.excluded, `${id} should be excluded`);
      } else {
        assert(!node.excluded, `${id} should not be excluded`);
        let expectedMap = new Map(expected);

        assertDependencyUsedSymbols(node.usedSymbolsUp, expectedMap, id);
      }
    }
  }
}

function readSymbolSet(s: $ReadOnlySet<number>): $ReadOnlySet<string> {
  return new Set([...s].map(s => DB.readString(s)));
}

function assertSetEqual<T>(
  actual: $ReadOnlySet<T>,
  expected: $ReadOnlySet<T>,
  prefix?: string = '',
) {
  assert(
    setEqual(actual, expected),
    `${prefix} [${[...actual].join(',')}] wasn't [${[...expected].join(',')}]`,
  );
}

async function testPropagation(
  assets: Array<
    [
      FilePath,
      /* symbols (or cleared) */ ?Array<
        [Symbol, {|local: Symbol, loc?: ?SourceLocation, meta?: ?Meta|}],
      >,
      /* sideEffects */ boolean,
      /* usedSymbols */ Array<Symbol>,
    ],
  >,
  dependencies: Array<
    [
      /* from */ FilePath,
      /* to */ FilePath,
      /* symbols (or cleared) */ ?Array<
        [
          Symbol,
          {|
            local: Symbol,
            loc?: ?SourceLocation,
            isWeak: boolean,
            meta?: ?Meta,
          |},
        ],
      >,
      /* usedSymbols */ Array<
        [Symbol, ?[FilePath, ?Symbol]] | [Symbol],
      > | /* excluded */ null,
    ],
  >,
  isLibrary?: boolean,
): Promise<AssetGraph> {
  let {graph, changedAssets} = createAssetGraph(
    assets.map(([f, symbols, sideEffects]) => [f, symbols, sideEffects]),
    dependencies.map(([from, to, symbols]) => [from, to, symbols]),
    isLibrary,
  );
  await dumpGraphToGraphViz(DB, graph, 'test_before');

  handlePropagationErrors(
    propagateSymbols({
      options: DEFAULT_OPTIONS,
      assetGraph: graph,
      changedAssetsPropagation: new Set(changedAssets.keys()),
      assetGroupsWithRemovedParents: new Set(),
      previousErrors: undefined,
    }),
  );

  await dumpGraphToGraphViz(DB, graph, 'test_after');

  assertUsedSymbols(
    graph,
    assets.map(([f, , , usedSymbols]) => [f, usedSymbols]),
    dependencies.map(([from, to, , usedSymbols]) => [from, to, usedSymbols]),
    isLibrary,
  );

  return graph;
}

function handlePropagationErrors(errors: Map<NodeId, Array<Diagnostic>>) {
  if (errors.size > 0) {
    throw new ThrowableDiagnostic({
      diagnostic: [...errors.values()][0],
    });
  }
}

function assertPropagationErrors(
  graph: AssetGraph,
  actual: Map<NodeId, Array<Diagnostic>>,
  expected: Iterable<[FilePath, Array<Diagnostic>]>,
) {
  assert.deepEqual(
    [...actual].map(([k, v]) => [
      Asset.get(DB, nullthrowsAssetNode(graph.getNode(k)).value).filePath,
      v,
    ]),
    [...expected],
  );
}

function changeDependency(
  graph: AssetGraph,
  from: FilePath,
  to: FilePath,
  cb: MutableDependencySymbols => void,
): Iterable<[AssetAddr, Asset]> {
  let sourceAssetNode = nullthrowsAssetNode(
    [...graph.nodes.values()].find(
      n => n?.type === 'asset' && Asset.get(DB, n.value).filePath === from,
    ),
  );
  sourceAssetNode.usedSymbolsDownDirty = true;
  let depNode = nullthrowsDependencyNode(
    [...graph.nodes.values()].find(
      n =>
        n?.type === 'dependency' &&
        Dependency.get(DB, n.value).sourceAssetId != null &&
        Asset.get(DB, nullthrows(Dependency.get(DB, n.value).sourceAssetId))
          .filePath === from &&
        Dependency.get(DB, n.value).specifier === to,
    ),
  );
  cb(new MutableDependencySymbols(DEFAULT_OPTIONS, depNode.value, {}));
  return [[sourceAssetNode.value, Asset.get(DB, sourceAssetNode.value)]];
}

function changeAsset(
  graph: AssetGraph,
  asset: FilePath,
  cb: MutableAssetSymbols => void,
): Iterable<[AssetAddr, Asset]> {
  let node = nullthrowsAssetNode(
    [...graph.nodes.values()].find(
      n => n?.type === 'asset' && Asset.get(DB, n.value).filePath === asset,
    ),
  );
  node.usedSymbolsUpDirty = true;
  node.usedSymbolsDownDirty = true;
  cb(new MutableAssetSymbols(DEFAULT_OPTIONS, node.value, {}));
  return [[node.value, Asset.get(DB, node.value)]];
}

// process.env.PARCEL_DUMP_GRAPHVIZ = '';
// process.env.PARCEL_DUMP_GRAPHVIZ = 'symbols';

describe('SymbolPropagation', () => {
  it('basic tree', async () => {
    // prettier-ignore
    await testPropagation(
      [
        ['/index.js', [], true, []],
        ['/lib.js', [['f', {local: 'lib1$foo'}], ['b', {local: 'lib2$bar'}]], false, []],
        ['/lib1.js', [['foo', {local: 'v'}]], false, ['foo']],
        ['/lib2.js', [['bar', {local: 'v'}]], false, []],
      ],
      [
        ['/index.js', '/lib.js', [['f', {local: 'f', isWeak: false}]], [['f', ['/lib1.js', 'foo']]]],
        ['/lib.js', '/lib1.js', [['foo', {local: 'lib1$foo', isWeak: true}]], [['foo']]],
        ['/lib.js', '/lib2.js', [['bar', {local: 'lib2$bar', isWeak: true}]], null],
      ],
    );
  });

  it('basic tree - dependency symbol change export', async () => {
    // prettier-ignore
    let graph = await testPropagation(
      [
        ['/index.js', [], true, []],
        ['/lib.js', [['f', {local: 'f'}], ['b', {local: 'b'}]], true, ['f']],
      ],
      [
        ['/index.js', '/lib.js', [['f', {local: 'f', isWeak: false}]], [['f']]],
      ],
    );

    let changedAssets = [
      ...changeDependency(graph, 'index.js', '/lib.js', symbols => {
        symbols.set('b', 'b');
      }),
    ];
    propagateSymbols({
      options: DEFAULT_OPTIONS,
      assetGraph: graph,
      changedAssetsPropagation: new Set(new Map(changedAssets).keys()),
      assetGroupsWithRemovedParents: new Set(),
    });

    // prettier-ignore
    assertUsedSymbols(graph,
      [
        ['/index.js', []],
        ['/lib.js', ['f', 'b']],
      ],
      [
        ['/index.js', '/lib.js', [['f'], ['b']]],
      ],
    );
  });

  it('basic tree - dependency symbol change import and error', async () => {
    // prettier-ignore
    let graph = await testPropagation(
      [
        ['/index.js', [], true, []],
        ['/lib.js', [['f', {local: 'f'}]], true, ['f']],
      ],
      [
        ['/index.js', '/lib.js', [['f', {local: 'f', isWeak: false}]], [['f']]],
      ],
    );

    let changedAssets = [
      ...changeDependency(graph, 'index.js', '/lib.js', symbols => {
        symbols.delete('f');
        symbols.set('f2', 'f2');
      }),
    ];
    let errors = propagateSymbols({
      options: DEFAULT_OPTIONS,
      assetGraph: graph,
      changedAssetsPropagation: new Set(new Map(changedAssets).keys()),
      assetGroupsWithRemovedParents: new Set(),
    });

    assertPropagationErrors(graph, errors, [
      [
        'lib.js',
        [
          {
            message: "lib.js does not export 'f2'",
            origin: '@parcel/core',
            codeFrames: undefined,
          },
        ],
      ],
    ]);
  });

  it('basic tree - asset symbol change export and error', async () => {
    // prettier-ignore
    let graph = await testPropagation(
      [
        ['/index.js', [], true, []],
        ['/lib.js', [['f', {local: 'f'}]], true, ['f']],
      ],
      [
        ['/index.js', '/lib.js', [['f', {local: 'f', isWeak: false}]], [['f']]],
      ],
    );

    let changedAssets = [
      ...changeAsset(graph, 'lib.js', symbols => {
        symbols.delete('f');
        symbols.set('f2', 'f2');
      }),
    ];

    let errors = propagateSymbols({
      options: DEFAULT_OPTIONS,
      assetGraph: graph,
      changedAssetsPropagation: new Set(new Map(changedAssets).keys()),
      assetGroupsWithRemovedParents: new Set(),
    });

    assertPropagationErrors(graph, errors, [
      [
        'lib.js',
        [
          {
            message: "lib.js does not export 'f'",
            origin: '@parcel/core',
            codeFrames: undefined,
          },
        ],
      ],
    ]);
  });

  it('basic tree - dependency symbol change reexport', async () => {
    // prettier-ignore
    let graph = await testPropagation(
      [
        ['/index.js', [], true, []],
        ['/lib.js', [['f', {local: 'lib1$foo'}], ['b', {local: 'lib2$bar'}]], true, []],
        ['/lib1.js', [['foo', {local: 'v'}]], true, ['foo']],
        ['/lib2.js', [['bar', {local: 'v'}]], true, []],
      ],
      [
        ['/index.js', '/lib.js', [['f', {local: 'f', isWeak: false}]], [['f']]],
        ['/lib.js', '/lib1.js', [['foo', {local: 'lib1$foo', isWeak: true}]], [['foo']]],
        ['/lib.js', '/lib2.js', [['bar', {local: 'lib2$bar', isWeak: true}]], []],
      ],
    );

    let changedAssets = [
      ...changeDependency(graph, 'index.js', '/lib.js', symbols => {
        symbols.set('b', 'b');
      }),
    ];
    propagateSymbols({
      options: DEFAULT_OPTIONS,
      assetGraph: graph,
      changedAssetsPropagation: new Set(new Map(changedAssets).keys()),
      assetGroupsWithRemovedParents: new Set(),
    });

    // prettier-ignore
    assertUsedSymbols(graph,
      [
        ['/index.js', []],
        ['/lib.js', []],
        ['/lib1.js', ['foo']],
        ['/lib2.js', ['bar']],
      ],
      [
        ['/index.js', '/lib.js', [['f'],['b']]],
        ['/lib.js', '/lib1.js', [['foo']]],
        ['/lib.js', '/lib2.js', [['bar']]],
      ],
    );
  });

  it('basic tree with reexport-all', async () => {
    // prettier-ignore
    await testPropagation(
      [
        ['/index.js', [], true, []],
        ['/lib.js', [], false, []],
        ['/lib1.js', [['foo', {local: 'v'}]], false, ['foo']],
        ['/lib2.js', [['bar', {local: 'v'}]], false, []],
      ],
      [
        ['/index.js', '/lib.js', [['foo', {local: 'foo', isWeak: false}]], [['foo', ['/lib1.js', 'foo']]]],
        ['/lib.js', '/lib1.js', [['*', {local: '*', isWeak: true}]], [['foo']]],
        ['/lib.js', '/lib2.js', [['*', {local: '*', isWeak: true}]], null],
      ],
    );
  });

  it('dependency with * imports everything', async () => {
    // prettier-ignore
    await testPropagation(
      [
        ['/index.js', [], true, []],
        ['/lib.js', [['a', {local: 'lib1$foo'}], ['b', {local: 'lib1$b'}]], true, ['*']],
        ['/lib1.js', [['b', {local: 'v'}]], true, ['b']],
        ['/lib2.js', [['c', {local: 'v'}]], true, ['*']],
      ],
      [
        ['/index.js', '/lib.js', [['*', {local: 'lib', isWeak: false}]], [['*']]],
        ['/lib.js', '/lib1.js', [['b', {local: 'lib1$foo', isWeak: true}]], [['b']]],
        // TODO should usedSymbolsUp actually list the individual symbols instead of '*'?
        ['/lib.js', '/lib2.js', [['*', {local: '*', isWeak: true}]], [['*']]],
      ],
    );
  });

  it('dependency with cleared symbols imports side-effect-full parts', async () => {
    // prettier-ignore
    await testPropagation(
      [
        ['/index.js', [], true, []],
        ['/lib.js', [['a', {local: 'lib1$foo'}], ['b', {local: 'lib$b'}]], true, ['b']],
        ['/lib1.js', [['b', {local: 'v'}]], true, ['b']],
        ['/lib2.js', [['c', {local: 'v'}]], false, ['*']],
      ],
      [
        ['/index.js', '/lib.js', null, []],
        ['/lib.js', '/lib1.js', [['b', {local: 'lib1$foo', isWeak: true}]], [['b']]],
        ['/lib.js', '/lib2.js', [['*', {local: '*', isWeak: true}]], [['*']]],
      ],
    );
  });

  it('dependency with cleared symbols imports side-effect-free package', async () => {
    // prettier-ignore
    await testPropagation(
      [
        ['/index.js', [], true, []],
        ['/lib.js', [['a', {local: 'lib$a'}], ['b', {local: 'lib1$b'}], ['c', {local: 'lib2$c'}]], false, ['a']],
        ['/lib1.js', [['b', {local: 'v'}]], false, ['b']],
        ['/lib2.js', [['c', {local: 'v'}]], false, ['c']],
        ['/lib3.js', [['d', {local: 'v'}]], false, ['*']],
      ],
      [
        ['/index.js', '/lib.js', null, []],
        ['/lib.js', '/lib1.js', [['b', {local: 'lib1$b', isWeak: true}]], [['b']]],
        ['/lib.js', '/lib2.js', [['c', {local: 'lib2$c', isWeak: true}]], [['c']]],
        ['/lib.js', '/lib3.js', [['*', {local: '*', isWeak: true}]], [['*']]],
      ],
    );
  });

  it('library build with entry dependency', async () => {
    // prettier-ignore
    await testPropagation(
      [
        ['/index.js', [["foo", {local: "foo"}], ['b', {local: 'b$b'}]], true, ['*']],
      ],
      [],
      true
    );
  });

  it('library build with entry dependency and reexport', async () => {
    // prettier-ignore
    await testPropagation(
      [
        ['/index.js', [["foo", {local: "foo"}], ['b', {local: 'b$b'}]], true, ['*']],
        ['/b.js', [['b', {local: 'b'}]], true, ['b']],
      ],
      [
        ['/index.js', '/b.js', [['b', {local: 'b$b', isWeak: false}]], [['b']]],
      ],
      true
    );
  });

  it('cyclic dependency', async () => {
    // prettier-ignore
    await testPropagation(
      [
        ['/index.js', [], true, []],
        ['/a.js', [['a', {local: 'b$b'}], ['real', {local: 'real'}]], true, ['real']],
        ['/b.js', [['b', {local: 'c$c'}]], true, []],
        ['/c.js', [['c', {local: 'a$real'}]], true, []],
      ],
      [
        ['/index.js', '/a.js', [['a', {local: 'a', isWeak: false}]], [['a']]],
        ['/a.js', '/b.js', [['b', {local: 'b$b', isWeak: true}]], [['b']]],
        ['/b.js', '/c.js', [['c', {local: 'c$c', isWeak: true}]], [['c']]],
        ['/c.js', '/a.js', [['real', {local: 'a$real', isWeak: true}]], [['real']]],
      ],
    );
  });
});
