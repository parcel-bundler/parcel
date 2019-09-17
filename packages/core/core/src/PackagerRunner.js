// @flow

import type {Blob, FilePath, BundleResult} from '@parcel/types';
import type SourceMap from '@parcel/source-map';
import type {Bundle as InternalBundle, ParcelOptions} from './types';
import type ParcelConfig from './ParcelConfig';
import type InternalBundleGraph from './BundleGraph';
import type {FileSystem, FileOptions} from '@parcel/fs';

import {
  urlJoin,
  md5FromObject,
  md5FromString,
  blobToStream
} from '@parcel/utils';
import {Readable} from 'stream';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import path from 'path';
import url from 'url';

import {NamedBundle} from './public/Bundle';
import {report} from './ReporterRunner';
import BundleGraph from './public/BundleGraph';
import PluginOptions from './public/PluginOptions';

type Opts = {|
  config: ParcelConfig,
  options: ParcelOptions
|};

export default class PackagerRunner {
  config: ParcelConfig;
  options: ParcelOptions;
  pluginOptions: PluginOptions;
  distDir: FilePath;
  distExists: Set<FilePath>;

  constructor({config, options}: Opts) {
    this.config = config;
    this.options = options;
    this.distExists = new Set();
    this.pluginOptions = new PluginOptions(this.options);
  }

  async writeBundle(bundle: InternalBundle, bundleGraph: InternalBundleGraph) {
    let {inputFS, outputFS} = this.options;
    let start = Date.now();

    let result, cacheKey;
    if (!this.options.disableCache) {
      cacheKey = await this.getCacheKey(bundle, bundleGraph);
      result = await this.readFromCache(cacheKey);
    }

    if (!result) {
      let packaged = await this.package(bundle, bundleGraph);
      let res = await this.optimize(
        bundle,
        bundleGraph,
        packaged.contents,
        packaged.map
      );

      let map = res.map ? await this.generateSourceMap(bundle, res.map) : null;
      result = {
        contents: res.contents,
        map
      };

      if (
        cacheKey != null &&
        // TODO This skips caching all packages that return Readable streams.
        !(result.contents instanceof Readable)
      ) {
        await this.writeToCache(cacheKey, result.contents, map);
      }
    }

    let {contents, map} = result;

    let filePath = nullthrows(bundle.filePath);
    let dir = path.dirname(filePath);
    if (!this.distExists.has(dir)) {
      await outputFS.mkdirp(dir);
      this.distExists.add(dir);
    }

    // Use the file mode from the entry asset as the file mode for the bundle.
    // Don't do this for browser builds, as the executable bit in particular is unnecessary.
    let publicBundle = new NamedBundle(bundle, bundleGraph, this.options);

    let options = publicBundle.env.isBrowser()
      ? undefined
      : {
          mode: (await inputFS.stat(
            nullthrows(publicBundle.getMainEntry()).filePath
          )).mode
        };

    let size;
    // console.log('PACKAGING', filePath);
    if (contents instanceof Readable) {
      // invariant(contents.bytesRead === 0);
      size = await writeFileStream(outputFS, filePath, contents, options);
      console.log(
        'wrote',
        size,
        'to',
        filePath,
        'from bytes',
        contents.bytesRead
      );
    } else {
      await outputFS.writeFile(filePath, contents, options);
      size = contents.length;
    }

    if (map != null) {
      if (map instanceof Readable) {
        await writeFileStream(outputFS, filePath + '.map', map);
      } else {
        await outputFS.writeFile(filePath + '.map', map);
      }
    }

    return {
      time: Date.now() - start,
      size
    };
  }

  async package(
    internalBundle: InternalBundle,
    bundleGraph: InternalBundleGraph
  ): Promise<BundleResult> {
    let bundle = new NamedBundle(internalBundle, bundleGraph, this.options);
    report({
      type: 'buildProgress',
      phase: 'packaging',
      bundle
    });

    let packager = await this.config.getPackager(bundle.filePath);
    let packaged = await packager.package({
      bundle,
      bundleGraph: new BundleGraph(bundleGraph, this.options),
      sourceMapPath: path.basename(bundle.filePath) + '.map',
      options: this.pluginOptions
    });

    return {
      contents:
        typeof packaged.contents === 'string'
          ? replaceReferences(
              packaged.contents,
              generateDepToBundlePath(internalBundle, bundleGraph)
            )
          : packaged.contents,
      map: packaged.map
    };
  }

  async optimize(
    internalBundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    contents: Blob,
    map?: ?SourceMap
  ): Promise<BundleResult> {
    let bundle = new NamedBundle(internalBundle, bundleGraph, this.options);
    let optimizers = await this.config.getOptimizers(bundle.filePath);
    if (!optimizers.length) {
      return {contents, map};
    }

    report({
      type: 'buildProgress',
      phase: 'optimizing',
      bundle
    });

    let optimized = {contents, map};
    for (let optimizer of optimizers) {
      optimized = await optimizer.optimize({
        bundle,
        contents: optimized.contents,
        map: optimized.map,
        options: this.pluginOptions
      });
    }

    return optimized;
  }

  generateSourceMap(bundle: InternalBundle, map: SourceMap): Promise<string> {
    // sourceRoot should be a relative path between outDir and rootDir for node.js targets
    let filePath = nullthrows(bundle.filePath);
    let sourceRoot: string = path.relative(
      path.dirname(filePath),
      this.options.projectRoot
    );
    let inlineSources = false;

    if (bundle.target) {
      if (
        bundle.target.sourceMap &&
        bundle.target.sourceMap.sourceRoot !== undefined
      ) {
        sourceRoot = bundle.target.sourceMap.sourceRoot;
      } else if (
        bundle.target.env.context === 'browser' &&
        this.options.mode !== 'production'
      ) {
        sourceRoot = '/__parcel_source_root';
      }

      if (
        bundle.target.sourceMap &&
        bundle.target.sourceMap.inlineSources !== undefined
      ) {
        inlineSources = bundle.target.sourceMap.inlineSources;
      } else if (bundle.target.env.context !== 'node') {
        // inlining should only happen in production for browser targets by default
        inlineSources = this.options.mode === 'production';
      }
    }

    let mapFilename = filePath + '.map';
    return map.stringify({
      file: path.basename(mapFilename),
      rootDir: this.options.projectRoot,
      sourceRoot: !inlineSources
        ? url.format(url.parse(sourceRoot + '/'))
        : undefined,
      inlineSources
    });
  }

  getCacheKey(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph
  ): string {
    let filePath = nullthrows(bundle.filePath);
    let packager = this.config.getPackagerName(filePath);
    let optimizers = this.config.getOptimizerNames(filePath);
    let deps = Promise.all(
      [packager, ...optimizers].map(async pkg => {
        let {pkg: resolvedPkg} = await this.options.packageManager.resolve(
          `${pkg}/package.json`,
          `${this.config.filePath}/index` // TODO: is this right?
        );

        let version = nullthrows(resolvedPkg).version;
        return [pkg, version];
      })
    );

    // TODO: add third party configs to the cache key
    let {minify, scopeHoist, sourceMaps} = this.options;
    return md5FromObject({
      deps,
      opts: {minify, scopeHoist, sourceMaps},
      hash: bundleGraph.getHash(bundle)
    });
  }

  async readFromCache(
    cacheKey: string
  ): Promise<?{
    contents: Readable,
    map: ?Readable,
    ...
  }> {
    let contentKey = md5FromString(`${cacheKey}:content`);
    let mapKey = md5FromString(`${cacheKey}:map`);

    let contentExists = await this.options.cache.blobExists(contentKey);
    if (!contentExists) {
      return null;
    }

    let mapExists = await this.options.cache.blobExists(mapKey);

    let contents = this.options.cache.getStream(contentKey);
    // let oldRead = contents.read;
    // contents.read = function newRead(size) {
    //   console.trace('BEING READ FROM');
    //   oldRead.call(contents, size);
    //   debugger;
    // };

    return {
      contents,
      map: mapExists ? this.options.cache.getStream(mapKey) : null
    };
  }

  async writeToCache(cacheKey: string, contents: Blob, map: ?Blob) {
    let contentKey = md5FromString(`${cacheKey}:content`);

    await this.options.cache.setStream(contentKey, blobToStream(contents));

    if (map != null) {
      let mapKey = md5FromString(`${cacheKey}:map`);
      await this.options.cache.setStream(mapKey, blobToStream(map));
    }
  }
}

function writeFileStream(
  fs: FileSystem,
  filePath: FilePath,
  stream: Readable,
  options: ?FileOptions
): Promise<number> {
  return new Promise((resolve, reject) => {
    let fsStream = fs.createWriteStream(filePath, options);
    stream
      .pipe(fsStream)
      // $FlowFixMe
      .on('finish', () => resolve(fsStream.bytesWritten))
      .on('error', reject);
  });
}

/*
 * Build a mapping from async, url dependency ids to web-friendly relative paths
 * to their bundles. These will be relative to the current bundle if `publicUrl`
 * is not provided. If `publicUrl` is provided, the paths will be joined to it.
 *
 * These are used to translate any placeholder dependency ids written during
 * transformation back to a path that can be loaded in a browser (such as
 * in a "raw" loader or any transformed dependencies referred to by url).
 */
function generateDepToBundlePath(
  bundle: InternalBundle,
  bundleGraph: InternalBundleGraph
): Map<string, FilePath> {
  let depToBundlePath: Map<string, FilePath> = new Map();
  bundleGraph.traverseBundle(bundle, node => {
    if (node.type !== 'dependency') {
      return;
    }

    let dep = node.value;
    if (!dep.isURL || !dep.isAsync) {
      return;
    }

    let [bundleGroupNode] = bundleGraph._graph.getNodesConnectedFrom(node);
    invariant(bundleGroupNode && bundleGroupNode.type === 'bundle_group');

    let [entryBundleNode] = bundleGraph._graph.getNodesConnectedFrom(
      bundleGroupNode,
      'bundle'
    );
    invariant(entryBundleNode && entryBundleNode.type === 'bundle');

    let entryBundle = entryBundleNode.value;
    depToBundlePath.set(
      dep.id,
      urlJoin(
        nullthrows(entryBundle.target).publicUrl ?? '/',
        nullthrows(entryBundle.name)
      )
    );
  });

  return depToBundlePath;
}

// replace references to url dependencies with relative paths to their
// corresponding bundles.
// TODO: This likely alters the length of the column in the source text.
//       Update any sourcemaps accordingly.
function replaceReferences(
  code: string,
  depToBundlePath: Map<string, FilePath>
): string {
  let output = code;
  for (let [depId, replacement] of depToBundlePath) {
    let split = output.split(depId);
    if (split.length > 1) {
      // the dependency id was found in the text. replace it.
      output = split.join(replacement);
    }
  }

  return output;
}
