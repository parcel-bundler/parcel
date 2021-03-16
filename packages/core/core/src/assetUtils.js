// @flow strict-local

import type {
  ASTGenerator,
  FilePath,
  GenerateOutput,
  Meta,
  PackageName,
  Stats,
  Symbol,
  SourceLocation,
  Transformer,
  QueryParameters,
} from '@parcel/types';
import type {
  Asset,
  RequestInvalidation,
  Dependency,
  Environment,
  ParcelOptions,
} from './types';
import {objectSortedEntries} from '@parcel/utils';
import type {ConfigOutput} from '@parcel/utils';

import {Readable} from 'stream';
import crypto from 'crypto';
import {PluginLogger} from '@parcel/logger';
import nullthrows from 'nullthrows';
import CommittedAsset from './CommittedAsset';
import UncommittedAsset from './UncommittedAsset';
import loadPlugin from './loadParcelPlugin';
import {Asset as PublicAsset} from './public/Asset';
import PluginOptions from './public/PluginOptions';
import {
  blobToStream,
  loadConfig,
  md5FromOrderedObject,
  md5FromFilePath,
} from '@parcel/utils';
import {hashFromOption} from './utils';
import {createBuildCache} from './buildCache';

type AssetOptions = {|
  id?: string,
  committed?: boolean,
  hash?: ?string,
  idBase?: ?string,
  filePath: FilePath,
  query?: ?QueryParameters,
  type: string,
  contentKey?: ?string,
  mapKey?: ?string,
  astKey?: ?string,
  astGenerator?: ?ASTGenerator,
  dependencies?: Map<string, Dependency>,
  isIsolated?: boolean,
  isInline?: boolean,
  isSplittable?: ?boolean,
  isSource: boolean,
  env: Environment,
  meta?: Meta,
  outputHash?: ?string,
  pipeline?: ?string,
  stats: Stats,
  symbols?: ?Map<Symbol, {|local: Symbol, loc: ?SourceLocation, meta?: ?Meta|}>,
  sideEffects?: boolean,
  uniqueKey?: ?string,
  plugin?: PackageName,
  configPath?: FilePath,
  configKeyPath?: string,
|};

function createAssetIdFromOptions(options: AssetOptions): string {
  let uniqueKey = options.uniqueKey ?? '';
  let idBase = options.idBase != null ? options.idBase : options.filePath;
  let queryString = options.query ? objectSortedEntries(options.query) : '';

  return md5FromOrderedObject({
    idBase,
    type: options.type,
    env: options.env.id,
    uniqueKey,
    pipeline: options.pipeline ?? '',
    queryString,
  });
}

export function createAsset(options: AssetOptions): Asset {
  return {
    id: options.id != null ? options.id : createAssetIdFromOptions(options),
    committed: options.committed ?? false,
    hash: options.hash,
    filePath: options.filePath,
    query: options.query,
    isIsolated: options.isIsolated ?? false,
    isInline: options.isInline ?? false,
    isSplittable: options.isSplittable,
    type: options.type,
    contentKey: options.contentKey,
    mapKey: options.mapKey,
    astKey: options.astKey,
    astGenerator: options.astGenerator,
    dependencies: options.dependencies || new Map(),
    isSource: options.isSource,
    outputHash: options.outputHash,
    pipeline: options.pipeline,
    env: options.env,
    meta: options.meta || {},
    stats: options.stats,
    symbols: options.symbols,
    sideEffects: options.sideEffects ?? true,
    uniqueKey: options.uniqueKey ?? '',
    plugin: options.plugin,
    configPath: options.configPath,
    configKeyPath: options.configKeyPath,
  };
}

const generateResults: WeakMap<Asset, Promise<GenerateOutput>> = new WeakMap();

export function generateFromAST(
  asset: CommittedAsset | UncommittedAsset,
): Promise<GenerateOutput> {
  let output = generateResults.get(asset.value);
  if (output == null) {
    output = _generateFromAST(asset);
    generateResults.set(asset.value, output);
  }
  return output;
}

async function _generateFromAST(asset: CommittedAsset | UncommittedAsset) {
  let ast = await asset.getAST();
  if (ast == null) {
    throw new Error('Asset has no AST');
  }

  let pluginName = nullthrows(asset.value.plugin);
  let {plugin} = await loadPlugin<Transformer>(
    pluginName,
    nullthrows(asset.value.configPath),
    nullthrows(asset.value.configKeyPath),
    asset.options,
  );
  let generate = plugin.generate?.bind(plugin);
  if (!generate) {
    throw new Error(`${pluginName} does not have a generate method`);
  }

  let {content, map} = await generate({
    asset: new PublicAsset(asset),
    ast,
    options: new PluginOptions(asset.options),
    logger: new PluginLogger({origin: pluginName}),
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

export async function getConfig(
  asset: CommittedAsset | UncommittedAsset,
  filePaths: Array<FilePath>,
  options: ?{|
    packageKey?: string,
    parse?: boolean,
  |},
): Promise<ConfigOutput | null> {
  let packageKey = options?.packageKey;
  let parse = options && options.parse;

  if (packageKey != null) {
    let pkg = await asset.getPackage();
    if (pkg && pkg[packageKey]) {
      return {
        config: pkg[packageKey],
        // The package.json file was already registered by asset.getPackage() -> asset.getConfig()
        files: [],
      };
    }
  }

  let conf = await loadConfig(
    asset.options.inputFS,
    asset.value.filePath,
    filePaths,
    parse == null ? null : {parse},
  );
  if (!conf) {
    return null;
  }

  return conf;
}

export function getInvalidationId(invalidation: RequestInvalidation): string {
  switch (invalidation.type) {
    case 'file':
      return 'file:' + invalidation.filePath;
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

  let hash = crypto.createHash('md5');
  for (let invalidation of sortedInvalidations) {
    switch (invalidation.type) {
      case 'file': {
        // Only recompute the hash of this file if we haven't seen it already during this build.
        let fileHash = hashCache.get(invalidation.filePath);
        if (fileHash == null) {
          fileHash = await md5FromFilePath(
            options.inputFS,
            invalidation.filePath,
          );
          hashCache.set(invalidation.filePath, fileHash);
        }
        hash.update(fileHash);
        break;
      }
      case 'env':
        hash.update(
          invalidation.key + ':' + (options.env[invalidation.key] || ''),
        );
        break;
      case 'option':
        hash.update(
          invalidation.key + ':' + hashFromOption(options[invalidation.key]),
        );
        break;
      default:
        throw new Error('Unknown invalidation type: ' + invalidation.type);
    }
  }

  return hash.digest('hex');
}
