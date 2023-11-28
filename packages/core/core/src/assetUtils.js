// @flow strict-local

import type {
  BundleBehavior,
  FilePath,
  GenerateOutput,
  Meta,
  Stats,
  Symbol,
  SourceLocation,
  Transformer,
} from '@parcel/types';
import type {RequestInvalidation, ParcelOptions} from './types';
import type {AssetAddr, EnvironmentAddr} from '@parcel/rust';

import {Readable} from 'stream';
import {PluginLogger} from '@parcel/logger';
import nullthrows from 'nullthrows';
import CommittedAsset from './CommittedAsset';
import loadPlugin from './loadParcelPlugin';
import {CommittedAsset as PublicAsset} from './public/Asset';
import PluginOptions from './public/PluginOptions';
import {blobToStream, hashFile} from '@parcel/utils';
import {hashFromOption, toDbSourceLocation} from './utils';
import {createBuildCache} from './buildCache';
import {
  type ProjectPath,
  fromProjectPath,
  fromProjectPathRelative,
} from './projectPath';
import {
  hashString,
  ParcelDb,
  Asset as DbAsset,
  AssetFlags,
  SymbolFlags,
} from '@parcel/rust';
import {PluginTracer} from '@parcel/profiler';
import type {Scope} from './scopeCache';
import type BundleGraph from './BundleGraph';

type AssetOptions = {|
  id?: string,
  committed?: boolean,
  hash?: ?string,
  idBase?: ?string,
  filePath: ProjectPath,
  query?: ?string,
  type: string,
  bundleBehavior?: BundleBehavior | 'none',
  isBundleSplittable?: ?boolean,
  isSource?: boolean,
  env: EnvironmentAddr,
  pipeline?: ?string,
  stats?: Stats,
  symbols?: ?Map<Symbol, {|local: Symbol, loc: ?SourceLocation, meta?: ?Meta|}>,
  sideEffects?: boolean,
  uniqueKey?: ?string,
|};

export function createAssetIdFromOptions(options: AssetOptions): string {
  let uniqueKey = options.uniqueKey ?? '';
  let idBase =
    options.idBase != null
      ? options.idBase
      : fromProjectPathRelative(options.filePath);

  return hashString(
    idBase +
      options.type +
      String(options.env) +
      uniqueKey +
      ':' +
      (options.pipeline ?? '') +
      ':' +
      (options.query ?? ''),
  );
}

export function createAsset(
  db: ParcelDb,
  projectRoot: FilePath,
  options: AssetOptions,
): DbAsset {
  let asset = new DbAsset(db);
  asset.id = db.getStringId(
    options.id != null ? options.id : createAssetIdFromOptions(options),
  );
  asset.filePath = options.filePath;
  asset.env = options.env;
  asset.query = options.query;
  asset.assetType = options.type;
  asset.contentKey = '';
  asset.mapKey = null;
  asset.outputHash = '';
  asset.uniqueKey = options.uniqueKey;
  asset.pipeline = options.pipeline;
  asset.stats.size = options.stats?.size ?? 0;
  asset.stats.time = options.stats?.time ?? 0;
  asset.bundleBehavior = options.bundleBehavior || 'none';
  asset.flags =
    (options.isSource ?? true ? AssetFlags.IS_SOURCE : 0) |
    (options.isBundleSplittable ?? true ? AssetFlags.IS_BUNDLE_SPLITTABLE : 0) |
    (options.sideEffects ?? true ? AssetFlags.SIDE_EFFECTS : 0);
  asset.meta = null;
  asset.ast = null;

  asset.symbols.init();
  if (options.symbols) {
    for (let [exported, {local, loc, meta}] of options.symbols) {
      let sym = asset.symbols.extend();
      sym.exported = db.getStringId(exported);
      sym.local = db.getStringId(local);
      sym.flags = meta?.isEsm === true ? SymbolFlags.IS_ESM : 0;
      sym.loc = toDbSourceLocation(db, projectRoot, loc);
    }
  }

  return asset;
}

const generateResults: Map<
  AssetAddr,
  Promise<GenerateOutput>,
> = createBuildCache();

export function generateFromAST(
  asset: CommittedAsset,
  bundleGraph: BundleGraph,
  scope: Scope,
): Promise<GenerateOutput> {
  let output = generateResults.get(asset.value.addr);
  if (output == null) {
    output = _generateFromAST(asset, bundleGraph, scope);
    generateResults.set(asset.value.addr, output);
  }
  return output;
}

async function _generateFromAST(
  asset: CommittedAsset,
  bundleGraph: BundleGraph,
  scope: Scope,
) {
  let ast = await asset.getAST();
  if (ast == null) {
    throw new Error('Asset has no AST');
  }

  let info = nullthrows(asset.value.ast);
  let pluginName = nullthrows(info.plugin);
  let {plugin} = await loadPlugin<Transformer<mixed>>(
    pluginName,
    fromProjectPath(asset.options.projectRoot, nullthrows(info.configPath)),
    nullthrows(info.configKeyPath),
    asset.options,
  );
  let generate = plugin.generate?.bind(plugin);
  if (!generate) {
    throw new Error(`${pluginName} does not have a generate method`);
  }

  let {content, map} = await generate({
    asset: new PublicAsset(asset, bundleGraph, scope),
    ast,
    options: new PluginOptions(asset.options),
    logger: new PluginLogger({origin: pluginName}),
    tracer: new PluginTracer({origin: pluginName, category: 'asset-generate'}),
  });

  let mapBuffer = map?.toBuffer();
  // Store the results in the cache so we can avoid generating again next time
  await Promise.all([
    asset.options.cache.setStream(
      nullthrows(asset.value.contentKey),
      blobToStream(content),
    ),
    mapBuffer != null &&
      asset.options.cache.setBlob(nullthrows(asset.value.mapKey), mapBuffer),
  ]);

  return {
    content:
      content instanceof Readable
        ? asset.options.cache.getStream(nullthrows(asset.value.contentKey))
        : content,
    map,
  };
}

export function getInvalidationId(invalidation: RequestInvalidation): string {
  switch (invalidation.type) {
    case 'file':
      return 'file:' + fromProjectPathRelative(invalidation.filePath);
    case 'env':
      return 'env:' + invalidation.key;
    case 'option':
      return 'option:' + invalidation.key;
    default:
      throw new Error('Unknown invalidation type: ' + invalidation.type);
  }
}

const hashCache = createBuildCache();

export async function getInvalidationHash(
  invalidations: Array<RequestInvalidation>,
  options: ParcelOptions,
): Promise<string> {
  if (invalidations.length === 0) {
    return '';
  }

  let sortedInvalidations = invalidations
    .slice()
    .sort((a, b) => (getInvalidationId(a) < getInvalidationId(b) ? -1 : 1));

  let hashes = '';
  for (let invalidation of sortedInvalidations) {
    switch (invalidation.type) {
      case 'file': {
        // Only recompute the hash of this file if we haven't seen it already during this build.
        let fileHash = hashCache.get(invalidation.filePath);
        if (fileHash == null) {
          fileHash = hashFile(
            options.inputFS,
            fromProjectPath(options.projectRoot, invalidation.filePath),
          );
          hashCache.set(invalidation.filePath, fileHash);
        }
        hashes += await fileHash;
        break;
      }
      case 'env':
        hashes +=
          invalidation.key + ':' + (options.env[invalidation.key] || '');
        break;
      case 'option':
        hashes +=
          invalidation.key + ':' + hashFromOption(options[invalidation.key]);
        break;
      default:
        throw new Error('Unknown invalidation type: ' + invalidation.type);
    }
  }

  return hashString(hashes);
}
