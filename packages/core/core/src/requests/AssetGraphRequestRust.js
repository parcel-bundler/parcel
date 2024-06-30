// @flow strict-local

import type {NodeId} from '@parcel/graph';
import type {Async} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import {
  DependencyFlags,
  type Asset,
  type AssetGroup,
  AssetFlags,
  EnvironmentFlags,
  type ParcelOptions,
} from '../types';
import type {StaticRunOpts} from '../RequestTracker';

import {EntryResolver} from './EntryRequest';
import {TargetResolver} from './TargetRequest';
import {hashString} from '@parcel/rust';
import {requestTypes} from '../RequestTracker';
import {ParcelRust} from '@parcel/rust';
import {loadParcelConfig} from './ParcelConfigRequest';
import {
  type ProjectPath,
  fromProjectPath,
  fromProjectPathRelative,
  toProjectPath,
} from '../projectPath';
import loadPlugin from '../loadParcelPlugin';
import UncommittedAsset from '../UncommittedAsset';
import {Asset as PublicAsset, MutableAsset} from '../public/Asset';
import PluginOptions from '../public/PluginOptions';
import {PluginLogger} from '@parcel/logger';
import {createConfig} from '../InternalConfig';
import PublicConfig from '../public/Config';
import {createAssetIdFromOptions} from '../assetUtils';
import AssetGraph from '../AssetGraph';
import {nodeFromAssetGroup} from '../AssetGraph';
import invariant from 'assert';
import {propagateSymbols} from '../SymbolPropagation';
import {PluginTracer} from '@parcel/profiler';
import ThrowableDiagnostic from '@parcel/diagnostic';
import {NodeFS} from '@parcel/fs';
import path from 'path';

type AssetGraphRequestInput = {|
  entries?: Array<ProjectPath>,
  assetGroups?: Array<AssetGroup>,
  optionsRef: SharedReference,
  name: string,
  shouldBuildLazily?: boolean,
  lazyIncludes?: RegExp[],
  lazyExcludes?: RegExp[],
  requestedAssetIds?: Set<string>,
|};

type AssetGraphRequestResult = {|
  assetGraph: AssetGraph,
  /** Assets added/modified since the last successful build. */
  changedAssets: Map<string, Asset>,
  /** Assets added/modified since the last symbol propagation invocation. */
  changedAssetsPropagation: Set<string>,
  assetGroupsWithRemovedParents: ?Set<NodeId>,
  // previousSymbolPropagationErrors: ?Map<NodeId, Array<Diagnostic>>,
  assetRequests: Array<AssetGroup>,
|};

type RunInput = {|
  input: AssetGraphRequestInput,
  ...StaticRunOpts<AssetGraphRequestResult>,
|};

type AssetGraphRequest = {|
  id: string,
  +type: typeof requestTypes.asset_graph_request,
  run: RunInput => Async<AssetGraphRequestResult>,
  input: AssetGraphRequestInput,
|};

export default function createAssetGraphRequestRust(
  input: AssetGraphRequestInput,
): AssetGraphRequest {
  return {
    type: requestTypes.asset_graph_request,
    id: input.name,
    run: async input => {
      let options = input.options;
      let result = await input.rustParcel.buildAssetGraph();

      if (result.Err) {
        throw new ThrowableDiagnostic({
          diagnostic: result.Err,
        });
      }

      let serializedAssetGraph = result.Ok;
      let [assetGraph, changedAssets] = getAssetGraph(
        serializedAssetGraph,
        options,
      );
      let changedAssetsPropagation = new Set(changedAssets.keys());
      let errors = propagateSymbols({
        options,
        assetGraph,
        changedAssetsPropagation,
        assetGroupsWithRemovedParents: new Set(),
        previousErrors: new Map(), //this.previousSymbolPropagationErrors,
      });

      if (errors.size > 0) {
        // Just throw the first error. Since errors can bubble (e.g. reexporting a reexported symbol also fails),
        // determining which failing export is the root cause is nontrivial (because of circular dependencies).
        throw new ThrowableDiagnostic({
          diagnostic: [...errors.values()][0],
        });
      }

      return {
        assetGraph,
        changedAssets,
        changedAssetsPropagation,
        assetGroupsWithRemovedParents: new Set(),
        assetRequests: [],
      };
    },
    input,
  };
}

export function createRustParcel(options: ParcelOptions) {
  return new ParcelRust(
    options.entries,
    {
      ...options,
      corePath: path.dirname(__dirname),
      fs:
        options.inputFS instanceof NodeFS
          ? null
          : {
              canonicalize: path => {
                try {
                  return options.inputFS.realpathSync(path);
                } catch (err) {
                  return err;
                }
              },
              read: path => {
                try {
                  return options.inputFS.readFileSync(path);
                } catch (err) {
                  return err;
                }
              },
              readString: path => {
                try {
                  return options.inputFS.readFileSync(path, 'utf8');
                } catch (err) {
                  return err;
                }
              },
              isFile: path => {
                try {
                  return options.inputFS.statSync(path).isFile();
                } catch (err) {
                  return err;
                }
              },
              isDir: path => {
                try {
                  return options.inputFS.statSync(path).isDirectory();
                } catch (err) {
                  return err;
                }
              },
            },
    },
    async (err, request) => {
      // console.log(request)
      switch (request.type) {
        case 'Entry': {
          let entryResolver = new EntryResolver(options);
          let filePath = fromProjectPath(options.projectRoot, request.entry);
          let result = await entryResolver.resolveEntry(filePath);
          let invalidations = [];
          for (let file of result.files) {
            file = fromProjectPath(options.projectRoot, file.filePath);
            invalidations.push({InvalidateOnFileUpdate: file});
            invalidations.push({InvalidateOnFileDelete: file});
          }
          for (let glob of result.globs) {
            invalidations.push({InvalidateOnGlobCreate: glob});
          }
          return {
            type: 'Entry',
            value: {
              entries: result.entries.map(e => ({
                // TODO: use project paths in rust
                filePath: fromProjectPathRelative(e.filePath),
                packagePath: fromProjectPath(options.projectRoot, e.packagePath),
                target: e.target,
                loc: e.loc,
              })),
              invalidations
            }
          };
        }
        case 'ParcelConfig': {
          let {config} = await loadParcelConfig(options);
          return {
            type: 'ParcelConfig',
            value: config,
          };
        }
        case 'Target': {
          let invalidations = [];
          let targetResolver = new TargetResolver(
            {
              invalidateOnFileCreate(f) {
                if (f.filePath != null) {
                  invalidations.push({InvalidateOnFileCreate: fromProjectPath(options.projectRoot, f.filePath)});
                } else if (f.glob != null) {
                  invalidations.push({InvalidateOnGlobCreate: f.glob});
                } else {
                  invalidations.push({InvalidateOnFileCreateAbove: {file_name: f.fileName, above: fromProjectPath(options.projectRoot, f.aboveFilePath)}});
                }
              },
              invalidateOnFileUpdate(file) {
                let filePath = fromProjectPath(options.projectRoot, file);
                invalidations.push({InvalidateOnFileUpdate: filePath});
                invalidations.push({InvalidateOnFileDelete: filePath});
              },
              invalidateOnFileDelete() {},
              invalidateOnBuild() {
                // throw new Error('not implemented');
              },
              invalidateOnConfigKeyChange() {
                // throw new Error('not implemented');
              },
              invalidateOnEnvChange() {
                // throw new Error('not implemented');
              },
              invalidateOnOptionChange() {
                // throw new Error('not implemented');
              },
              invalidateOnStartup() {
                // throw new Error('not implemented');
              },
              canSkipSubrequest() {
                throw new Error('not implemented');
              },
              getInvalidSubRequests() {
                throw new Error('not implemented');
              },
              getInvalidations() {
                throw new Error('not implemented');
              },
              getPreviousResult() {
                throw new Error('not implemented');
              },
              getRequestResult() {
                throw new Error('not implemented');
              },
              getSubRequests() {
                throw new Error('not implemented');
              },
              runRequest() {
                throw new Error('not implemented');
              },
              storeResult() {
                throw new Error('not implemented');
              }
            },
            options,
          );
          let targets = await targetResolver.resolve(
            fromProjectPath(options.projectRoot, request.entry.filePath),
            request.entry.target,
          );
          return {
            type: 'Target',
            value: {
              targets,
              invalidations
            },
          };
        }
        case 'Transform': {
          let {plugin} = await loadPlugin(
            request.plugin.packageName,
            fromProjectPath(options.projectRoot, request.plugin.resolveFrom),
            request.plugin.keyPath,
            options,
          );
          try {
            let result = await runTransformer(
              request.plugin.packageName,
              plugin,
              request.asset,
              request.code,
              options,
            );
            return {
              type: 'Transform',
              value: result,
            };
          } catch (err) {
            console.log(err);
          }
        }
      }
    },
  );
}

async function runTransformer(
  transformerName,
  transformer,
  asset,
  content,
  options,
) {
  asset.dependencies = new Map();
  asset.filePath = toProjectPath(options.projectRoot, asset.filePath);
  asset.symbols =
    asset.flags & AssetFlags.HAS_SYMBOLS
      ? new Map(asset.symbols.map(s => [s.exported, s]))
      : null;
  let uncommittedAsset = new UncommittedAsset({
    value: asset,
    options,
    content,
  });

  // TODO: some fields have a different representation in Rust. Will need new public wrappers.
  let publicAsset = new PublicAsset(uncommittedAsset);
  let mutableAsset = new MutableAsset(uncommittedAsset);
  let pluginOptions = new PluginOptions(options);
  let logger = new PluginLogger({origin: transformerName});
  let tracer = new PluginTracer({
    origin: transformerName,
    category: 'transform',
  });
  let config = undefined;
  let invalidations = [];

  if (transformer.loadConfig) {
    config = createConfig({
      plugin: transformerName,
      isSource: Boolean(asset.flags & AssetFlags.IS_SOURCE),
      searchPath: asset.filePath,
      env: asset.env,
    });

    config.result = await transformer.loadConfig({
      config: new PublicConfig(config, options),
      options: pluginOptions,
      logger,
      tracer,
    });

    addInvalidations(options.projectRoot, config, invalidations);
  }

  if (transformer.parse) {
    let ast = await transformer.parse({
      asset: publicAsset,
      config: config?.result,
      options: pluginOptions,
      resolve: undefined,
      logger,
      tracer,
    });
    if (ast) {
      uncommittedAsset.setAST(ast);
      uncommittedAsset.isASTDirty = false;
    }
  }

  let results = await transformer.transform({
    asset: mutableAsset,
    config: config?.result,
    options: pluginOptions,
    resolve: undefined, // TODO
    logger,
    tracer,
  });

  let resultAsset = results[0]; // TODO: support multiple

  if (transformer.generate && uncommittedAsset.ast) {
    let output = await transformer.generate({
      asset: publicAsset,
      ast: uncommittedAsset.ast,
      options: pluginOptions,
      logger,
      tracer,
    });
    uncommittedAsset.content = output.content;
    uncommittedAsset.mapBuffer = output.map?.toBuffer();
    uncommittedAsset.clearAST();
  }

  // TODO: postProcess??

  if (resultAsset === mutableAsset) {
    if (asset.symbols) {
      asset.flags |= AssetFlags.HAS_SYMBOLS;
      asset.symbols = Array.from(asset.symbols).map(([k, v]) => ({
        exported: k,
        ...v,
      }));
    } else {
      asset.flags &= ~AssetFlags.HAS_SYMBOLS;
      asset.symbols = [];
    }
    asset.filePath = fromProjectPath(options.projectRoot, asset.filePath);
    let dependencies = Array.from(asset.dependencies.values());
    for (let dep of dependencies) {
      if (dep.symbols) {
        dep.flags |= DependencyFlags.HAS_SYMBOLS;
        dep.symbols = Array.from(asset.symbols).map(([k, v]) => ({
          exported: k,
          ...v,
        }));
      } else {
        dep.flags &= ~DependencyFlags.HAS_SYMBOLS;
        dep.symbols = [];
      }
      dep.sourcePath = fromProjectPath(options.projectRoot, dep.sourcePath);
      dep.resolveFrom = dep.resolveFrom
        ? fromProjectPath(options.projectRoot, dep.resolveFrom)
        : null;
      dep.placeholder ??= dep.id;
    }

    addInvalidations(options.projectRoot, uncommittedAsset.invalidations, invalidations);

    return {
      asset,
      dependencies,
      code: await uncommittedAsset.getBuffer(),
      invalidations
    };
  } else {
    throw new Error('todo');
  }
}

function addInvalidations(projectRoot, invalidations, result) {
  for (let file of invalidations.invalidateOnFileChange) {
    file = fromProjectPath(projectRoot, file);
    result.push({InvalidateOnFileUpdate: file});
    result.push({InvalidateOnFileDelete: file});
  }

  for (let f of invalidations.invalidateOnFileCreate) {
    if (f.filePath != null) {
      result.push({InvalidateOnFileCreate: fromProjectPath(projectRoot, f.filePath)});
    } else if (f.glob != null) {
      result.push({InvalidateOnGlobCreate: f.glob});
    } else {
      result.push({InvalidateOnFileCreateAbove: {file_name: f.fileName, above: fromProjectPath(projectRoot, f.aboveFilePath)}});
    }
  }
}

function getAssetGraph(serializedGraph, options) {
  let graph = new AssetGraph({
    _contentKeyToNodeId: new Map(),
    _nodeIdToContentKey: new Map(),
  });
  graph.safeToIncrementallyBundle = false;

  let changedAssets = new Map();
  let entry = 0;
  for (let node of serializedGraph.nodes) {
    if (node.type === 'root') {
      let index = graph.addNodeByContentKey('@@root', {
        id: '@@root',
        type: 'root',
        value: null,
      });
      graph.setRootNodeId(index);
    } else if (node.type === 'entry') {
      let id = 'entry:' + ++entry;
      graph.addNodeByContentKey(id, {
        id: id,
        type: 'root',
        value: null,
      });
    } else if (node.type === 'asset') {
      let id = node.value.id;
      let value = {
        ...node.value,
        committed: true,
        filePath: toProjectPath(options.projectRoot, node.value.filePath),
        flags: node.value.flags & ~AssetFlags.HAS_SYMBOLS,
        // backward compatibility
        symbols:
          node.value.flags & AssetFlags.HAS_SYMBOLS
            ? new Map(node.value.symbols.map(s => [s.exported, s]))
            : null,
      };
      changedAssets.set(id, value);
      graph.addNodeByContentKey(id, {
        id,
        type: 'asset',
        value,
        usedSymbols: new Set(),
        usedSymbolsDownDirty: true,
        usedSymbolsUpDirty: true,
      });
    } else if (node.type === 'dependency') {
      let id = node.value.id;
      let value = {
        ...node.value,
        specifier:
          node.value.flags & DependencyFlags.ENTRY
            ? toProjectPath(options.projectRoot, node.value.specifier)
            : node.value.specifier,
        sourcePath: node.value.sourcePath
          ? toProjectPath(options.projectRoot, node.value.sourcePath)
          : null,
        flags: node.value.flags & ~DependencyFlags.HAS_SYMBOLS,
        symbols:
          node.value.flags & DependencyFlags.HAS_SYMBOLS
            ? new Map(node.value.symbols.map(s => [s.exported, s]))
            : null,
      };
      let usedSymbolsDown = new Set();
      let usedSymbolsUp = new Map();
      if (
        value.flags & DependencyFlags.ENTRY &&
        value.env.flags & EnvironmentFlags.IS_LIBRARY
      ) {
        usedSymbolsDown.add('*');
        usedSymbolsUp.set('*', undefined);
      }
      graph.addNodeByContentKey(id, {
        id,
        type: 'dependency',
        value,
        deferred: false,
        hasDeferred: node.has_deferred,
        excluded: false,
        usedSymbolsDown,
        usedSymbolsUp,
        usedSymbolsDownDirty: true,
        usedSymbolsUpDirtyDown: true,
        usedSymbolsUpDirtyUp: true,
      });
    }
  }

  for (let i = 0; i < serializedGraph.edges.length; i += 2) {
    let from = serializedGraph.edges[i];
    let to = serializedGraph.edges[i + 1];
    let fromNode = graph.getNode(from);
    if (fromNode?.type === 'dependency') {
      let toNode = graph.getNode(to);
      invariant(toNode?.type === 'asset');

      // For backwards compatibility, create asset group node if needed.
      let assetGroupNode = nodeFromAssetGroup({
        filePath: toNode.value.filePath,
        env: fromNode.value.env,
        pipeline: toNode.value.pipeline,
        sideEffects: Boolean(toNode.value.flags & AssetFlags.SIDE_EFFECTS),
      });
      let index = graph.addNodeByContentKeyIfNeeded(
        assetGroupNode.id,
        assetGroupNode,
      );
      graph.addEdge(from, index);
      graph.addEdge(index, to);
    } else {
      graph.addEdge(from, to);
    }
  }

  return [graph, changedAssets];
}
