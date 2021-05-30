// @flow strict-local

import type {Async, FilePath} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type {StaticRunOpts} from '../RequestTracker';
import type {Bundle, ContentKey, DevDepRequest, ParcelOptions} from '../types';
import type {FileSystem, FileOptions} from '@parcel/fs';
import type BundleGraph from '../BundleGraph';
import type {BundleInfo} from '../PackagerRunner';

import {PARCEL_VERSION, HASH_REF_PREFIX, HASH_REF_REGEX} from '../constants';
import {serialize} from '../serializer';
import nullthrows from 'nullthrows';
import path from 'path';
import {hashString} from '@parcel/hash';
import {createPackageRequest} from './PackageRequest';
import {NamedBundle, bundleToInternalBundle} from '../public/Bundle';
import {TapStream} from '@parcel/utils';
import {Readable, Transform} from 'stream';

const BOUNDARY_LENGTH = HASH_REF_PREFIX.length + 32 - 1;

type WriteBundlesRequestInput = {|
  bundleGraph: BundleGraph,
  configRef: SharedReference,
  optionsRef: SharedReference,
|};

type RunInput = {|
  input: WriteBundlesRequestInput,
  ...StaticRunOpts,
|};

export type WriteBundlesRequest = {|
  id: ContentKey,
  +type: 'write_bundles_request',
  run: RunInput => Async<void>,
  input: WriteBundlesRequestInput,
|};

export default function createWriteBundlesRequest(
  input: WriteBundlesRequestInput,
): WriteBundlesRequest {
  return {
    type: 'write_bundles_request',
    id: 'WriteBundles',
    run,
    input,
  };
}

type CacheKeyMap = {|
  +content: string,
  +map: string,
  +info: string,
|};

async function run({input, api, farm, options}: RunInput) {
  let {bundleGraph, configRef, optionsRef} = input;
  let {ref, dispose} = await farm.createSharedReference(
    bundleGraph,
    serialize(bundleGraph),
  );

  let bundleInfoMap: {|
    [string]: BundleInfo,
  |} = {};
  let writeEarlyPromises = {};
  let hashRefToNameHash = new Map();
  let bundles = bundleGraph.getBundles().filter(bundle => {
    // Do not package and write placeholder bundles to disk. We just
    // need to update the name so other bundles can reference it.
    if (bundle.isPlaceholder) {
      let hash = bundle.id.slice(-8);
      hashRefToNameHash.set(bundle.hashReference, hash);
      let name = nullthrows(bundle.name).replace(bundle.hashReference, hash);
      bundle.filePath = path.join(bundle.target.distDir, name);
      return false;
    }

    // skip inline bundles, they will be processed via the parent bundle
    return !bundle.isInline;
  });

  try {
    await Promise.all(
      bundles.map(async bundle => {
        let request = createPackageRequest({
          bundle,
          bundleGraph,
          bundleGraphReference: ref,
          configRef,
          optionsRef,
        });
        let info = await api.runRequest(request);

        bundleInfoMap[bundle.id] = info;
        if (!info.hashReferences.length) {
          hashRefToNameHash.set(
            bundle.hashReference,
            options.shouldContentHash
              ? info.hash.slice(-8)
              : bundle.id.slice(-8),
          );
          writeEarlyPromises[bundle.id] = writeToDist({
            options,
            bundle,
            info,
            hashRefToNameHash,
            bundleGraph,
          });
        }
      }),
    );
    assignComplexNameHashes(hashRefToNameHash, bundles, bundleInfoMap, options);
    await Promise.all(
      bundles.map(
        bundle =>
          writeEarlyPromises[bundle.id] ??
          writeToDist({
            options,
            bundle,
            info: bundleInfoMap[bundle.id],
            hashRefToNameHash,
            bundleGraph,
          }),
      ),
    );
  } finally {
    await dispose();
  }
}

function assignComplexNameHashes(
  hashRefToNameHash,
  bundles,
  bundleInfoMap,
  options,
) {
  for (let bundle of bundles) {
    if (hashRefToNameHash.get(bundle.hashReference) != null) {
      continue;
    }

    hashRefToNameHash.set(
      bundle.hashReference,
      options.shouldContentHash
        ? hashString(
            [...getBundlesIncludedInHash(bundle.id, bundleInfoMap)]
              .map(bundleId => bundleInfoMap[bundleId].hash)
              .join(':'),
          ).slice(-8)
        : bundle.id.slice(-8),
    );
  }
}

function getBundlesIncludedInHash(
  bundleId,
  bundleInfoMap,
  included = new Set(),
) {
  included.add(bundleId);
  for (let hashRef of bundleInfoMap[bundleId].hashReferences) {
    let referencedId = getIdFromHashRef(hashRef);
    if (!included.has(referencedId)) {
      getBundlesIncludedInHash(referencedId, bundleInfoMap, included);
    }
  }

  return included;
}

function getIdFromHashRef(hashRef: string) {
  return hashRef.slice(HASH_REF_PREFIX.length);
}

async function writeToDist({
  options,
  bundle,
  bundleGraph,
  info,
  hashRefToNameHash,
}: {|
  options: ParcelOptions,
  bundle: Bundle,
  bundleGraph: BundleGraph,
  info: BundleInfo,
  hashRefToNameHash: Map<string, string>,
|}) {
  let {inputFS, outputFS} = options;
  let name = nullthrows(bundle.name);
  let thisHashReference = bundle.hashReference;

  if (info.type !== bundle.type) {
    name = name.slice(0, -path.extname(name).length) + '.' + info.type;
    bundle.type = info.type;
  }

  if (name.includes(thisHashReference)) {
    let thisNameHash = nullthrows(hashRefToNameHash.get(thisHashReference));
    name = name.replace(thisHashReference, thisNameHash);
  }

  let filePath = path.join(bundle.target.distDir, name);
  bundle.filePath = filePath;

  let dir = path.dirname(filePath);
  await outputFS.mkdirp(dir); // ? Got rid of dist exists, is this an expensive operation

  // Use the file mode from the entry asset as the file mode for the bundle.
  // Don't do this for browser builds, as the executable bit in particular is unnecessary.
  let publicBundle = NamedBundle.get(bundle, bundleGraph, options);
  let mainEntry = publicBundle.getMainEntry();
  let writeOptions =
    publicBundle.env.isBrowser() || !mainEntry
      ? undefined
      : {
          mode: (await inputFS.stat(mainEntry.filePath)).mode,
        };
  let cacheKeys = info.cacheKeys;
  let contentStream = options.cache.getStream(cacheKeys.content);
  let size = await writeFileStream(
    outputFS,
    filePath,
    contentStream,
    info.hashReferences,
    hashRefToNameHash,
    writeOptions,
  );
  bundle.stats = {
    size,
    time: info.time ?? 0,
  };

  let mapKey = cacheKeys.map;
  if (
    bundle.env.sourceMap &&
    !bundle.env.sourceMap.inline &&
    (await options.cache.has(mapKey))
  ) {
    let mapStream = options.cache.getStream(mapKey);
    await writeFileStream(
      outputFS,
      filePath + '.map',
      mapStream,
      info.hashReferences,
      hashRefToNameHash,
    );
  }
}

function writeFileStream(
  fs: FileSystem,
  filePath: FilePath,
  stream: Readable,
  hashReferences: Array<string>,
  hashRefToNameHash: Map<string, string>,
  options: ?FileOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let initialStream = hashReferences.length
      ? stream.pipe(replaceStream(hashRefToNameHash))
      : stream;
    let fsStream = fs.createWriteStream(filePath, options);
    let fsStreamClosed = new Promise(resolve => {
      fsStream.on('close', () => resolve());
    });
    let bytesWritten = 0;
    initialStream
      .pipe(
        new TapStream(buf => {
          bytesWritten += buf.length;
        }),
      )
      .pipe(fsStream)
      .on('finish', () => resolve(fsStreamClosed.then(() => bytesWritten)))
      .on('error', reject);
  });
}

function replaceStream(hashRefToNameHash) {
  let boundaryStr = '';
  return new Transform({
    transform(chunk, encoding, cb) {
      let str = boundaryStr + chunk.toString();
      let replaced = str.replace(HASH_REF_REGEX, match => {
        return hashRefToNameHash.get(match) || match;
      });
      boundaryStr = replaced.slice(replaced.length - BOUNDARY_LENGTH);
      let strUpToBoundary = replaced.slice(
        0,
        replaced.length - BOUNDARY_LENGTH,
      );
      cb(null, strUpToBoundary);
    },

    flush(cb) {
      cb(null, boundaryStr);
    },
  });
}
