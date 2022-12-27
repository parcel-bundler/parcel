/* eslint-disable no-unused-vars */
// @flow strict-local
import assert from 'assert';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import type {FilePath, SourceLocation, Meta, Symbol} from '@parcel/types';
import type {ContentKey, NodeId} from '@parcel/graph';
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
  fromProjectPath,
  toProjectPath as _toProjectPath,
} from '../src/projectPath';
import {propagateSymbols} from '../src/SymbolPropagation';
import dumpGraphToGraphViz from '../src/dumpGraphToGraphViz';
import {DEFAULT_ENV, DEFAULT_OPTIONS, DEFAULT_TARGETS} from './test-utils';
import type {
  Asset,
  AssetGroup,
  AssetGroupNode,
  AssetNode,
  Dependency,
  DependencyNode,
} from '../src/types';

const stats = {size: 0, time: 0};

function createAsset(opts) {
  return _createAsset('/', opts);
}

function createDependency(opts) {
  return _createDependency('/', opts);
}

function toProjectPath(p) {
  return _toProjectPath('/', p);
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
) {
  let graph = new AssetGraph();
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

  let assetId = 1;
  let changedAssets = new Map();
  let assetGroupNodes = new Map<FilePath, NodeId>();
  let assetNodes = new Map<FilePath, NodeId>();
  for (let [filePath, symbols, sideEffects] of assets) {
    let assetGroup = nodeFromAssetGroup({
      filePath: toProjectPath(filePath),
      env: DEFAULT_ENV,
      sideEffects,
    });
    let assetGroupNodeId = graph.addNodeByContentKey(assetGroup.id, assetGroup);
    assetGroupNodes.set(filePath, assetGroupNodeId);

    let asset = nodeFromAsset(
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
    changedAssets.set(String(assetId), asset.value);

    graph.addEdge(assetGroupNodeId, assetNodeId);

    assetId++;
  }

  for (let [from, to, symbols] of dependencies) {
    let dependencyNode = nodeFromDep(
      createDependency({
        specifier: to,
        specifierType: 'esm',
        env: DEFAULT_ENV,
        symbols: symbols ? new Map(symbols) : symbols,
        sourcePath: from,
        sourceAssetId: from,
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

  for (let [nodeId, node] of graph.nodes) {
    if (node.type === 'asset') {
      let filePath = fromProjectPath('/', node.value.filePath);
      let expected = new Set(nullthrows(expectedAsset.get(filePath)));
      assertSetEqual(node.usedSymbols, expected, filePath);
    } else if (node.type === 'dependency' && node.value.sourcePath != null) {
      let resolutionId = graph.getNodeIdsConnectedFrom(nodeId)[0];
      let resolution = nullthrows(graph.getNode(resolutionId));
      invariant(resolution.type === 'asset_group');
      let to = resolution.value.filePath;

      let id =
        fromProjectPath('/', nullthrows(node.value.sourcePath)) +
        ':' +
        fromProjectPath('/', nullthrows(to));
      let expected = expectedDependency.get(id);
      if (!expected) {
        assert(expected === null);
        assertSetEqual(new Set(node.usedSymbolsUp.keys()), new Set(), id);
        assert(node.excluded, `${id} should be excluded`);
      } else {
        assert(!node.excluded, `${id} should not be excluded`);
        let expectedMap = new Map(expected);

        assertSetEqual(
          new Set(node.usedSymbolsUp.keys()),
          new Set(expectedMap.keys()),
          id,
        );

        for (let [s, resolved] of node.usedSymbolsUp) {
          let exp = expectedMap.get(s);
          if (resolved && exp) {
            let asset = nullthrows(graph.getNodeByContentKey(resolved.asset));
            invariant(asset.type === 'asset');
            assert.strictEqual(
              fromProjectPath('/', asset.value.filePath),
              exp[0],
              `dep ${id}@${s} resolved asset: ${fromProjectPath(
                '/',
                asset.value.filePath,
              )} !== ${exp[0]}`,
            );
            assert.strictEqual(
              resolved.symbol,
              exp[1],
              `dep ${id}@${s} resolved symbol: ${String(
                resolved.symbol,
              )} !== ${String(exp[1])}`,
            );
          } else {
            assert.equal(resolved, exp);
          }
        }
      }
    }
  }
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
): Promise<AssetGraph> {
  let {graph, changedAssets} = createAssetGraph(
    assets.map(([f, symbols, sideEffects]) => [f, symbols, sideEffects]),
    dependencies.map(([from, to, symbols]) => [from, to, symbols]),
  );

  propagateSymbols({
    options: DEFAULT_OPTIONS,
    assetGraph: graph,
    changedAssets,
    dependenciesWithRemovedParents: new Set(),
    previousErrors: undefined,
  });

  await dumpGraphToGraphViz(graph, 'test');

  assertUsedSymbols(
    graph,
    assets.map(([f, , , usedSymbols]) => [f, usedSymbols]),
    dependencies.map(([from, to, , usedSymbols]) => [from, to, usedSymbols]),
  );

  return graph;
}

function changeDependency(
  graph: AssetGraph,
  from: FilePath,
  to: FilePath,
  cb: ($NonMaybeType<Dependency['symbols']>) => void,
): Iterable<[ContentKey, Asset]> {
  // $FlowFixMe
  let sourceAssetNode: AssetNode = nullthrows(
    [...graph.nodes.values()].find(
      n => n.type === 'asset' && n.value.filePath === 'index.js',
    ),
  );
  sourceAssetNode.usedSymbolsDownDirty = true;
  // $FlowFixMe
  let depNode: DependencyNode = nullthrows(
    [...graph.nodes.values()].find(
      n => n.type === 'dependency' && n.value.sourcePath === 'index.js',
    ),
  );
  cb(nullthrows(depNode.value.symbols));
  return [[sourceAssetNode.id, sourceAssetNode.value]];
}

process.env.PARCEL_DUMP_GRAPHVIZ = '';
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
      ...changeDependency(graph, '/index.js', '/lib.js', symbols => {
        symbols.set('b', {
          local: 'b',
          isWeak: false,
          loc: undefined,
        });
      }),
    ];
    propagateSymbols({
      options: DEFAULT_OPTIONS,
      assetGraph: graph,
      changedAssets: new Map(changedAssets),
      dependenciesWithRemovedParents: new Set(),
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
      ...changeDependency(graph, '/index.js', '/lib.js', symbols => {
        symbols.set('b', {
          local: 'b',
          isWeak: false,
          loc: undefined,
        });
      }),
    ];
    propagateSymbols({
      options: DEFAULT_OPTIONS,
      assetGraph: graph,
      changedAssets: new Map(changedAssets),
      dependenciesWithRemovedParents: new Set(),
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
        ['/lib.js', [['a', {local: 'lib1$foo'}], ['b', {local: 'lib1$b'}]], true, []],
        ['/lib1.js', [['b', {local: 'v'}]], true, []],
        ['/lib2.js', [['c', {local: 'v'}]], false, []],
      ],
      [
        ['/index.js', '/lib.js', null, []],
        ['/lib.js', '/lib1.js', [['b', {local: 'lib1$foo', isWeak: true}]], []],
        ['/lib.js', '/lib2.js', [['*', {local: '*', isWeak: true}]], null],
      ],
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
