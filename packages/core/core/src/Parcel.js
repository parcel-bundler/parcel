// @flow strict-local

import type {
  AsyncSubscription,
  BundleGraph as IBundleGraph,
  BuildFailureEvent,
  BuildSuccessEvent,
  EnvironmentOpts,
  FilePath,
  InitialParcelOptions,
  ModuleSpecifier,
  ParcelOptions,
  Stats
} from '@parcel/types';
import type {Bundle} from './types';
import type InternalBundleGraph from './BundleGraph';

import invariant from 'assert';
import Dependency from './Dependency';
import Environment from './Environment';
import {Asset} from './public/Asset';
import {BundleGraph} from './public/BundleGraph';
import BundlerRunner from './BundlerRunner';
import WorkerFarm from '@parcel/workers';
import nullthrows from 'nullthrows';
import clone from 'clone';
import Cache from '@parcel/cache';
import watcher from '@parcel/watcher';
import path from 'path';
import AssetGraphBuilder, {BuildAbortError} from './AssetGraphBuilder';
import ConfigResolver from './ConfigResolver';
import ReporterRunner from './ReporterRunner';
import MainAssetGraph from './public/MainAssetGraph';
import dumpGraphToGraphViz from './dumpGraphToGraphViz';
import resolveOptions from './resolveOptions';
import {ValueEmitter} from '@parcel/events';

type BuildEvent = BuildFailureEvent | BuildSuccessEvent;

export const INTERNAL_TRANSFORM = Symbol('internal_transform');
export const INTERNAL_RESOLVE = Symbol('internal_resolve');

export default class Parcel {
  #assetGraphBuilder; // AssetGraphBuilder
  #bundlerRunner; // BundlerRunner
  #farm; // WorkerFarm
  #initialized = false; // boolean
  #initialOptions; // InitialParcelOptions;
  #reporterRunner; // ReporterRunner
  #resolvedOptions = null; // ?ParcelOptions
  #runPackage; // (bundle: Bundle, bundleGraph: InternalBundleGraph) => Promise<Stats>;
  #watchEvents = new ValueEmitter<
    | {+error: Error, +buildEvent?: void}
    | {+buildEvent: BuildEvent, +error?: void}
  >();
  #watcherSubscription; // AsyncSubscription
  #watcherCount = 0; // number

  constructor(options: InitialParcelOptions) {
    this.#initialOptions = clone(options);
  }

  async init(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    let resolvedOptions: ParcelOptions = await resolveOptions(
      this.#initialOptions
    );
    this.#resolvedOptions = resolvedOptions;
    await Cache.createCacheDir(resolvedOptions.cacheDir);

    let configResolver = new ConfigResolver();
    let config;

    // If an explicit `config` option is passed use that, otherwise resolve a .parcelrc from the filesystem.
    if (resolvedOptions.config) {
      config = await configResolver.create(resolvedOptions.config);
    } else {
      config = await configResolver.resolve(resolvedOptions.rootDir);
    }

    // If no config was found, default to the `defaultConfig` option if one is provided.
    if (!config && resolvedOptions.defaultConfig) {
      config = await configResolver.create(resolvedOptions.defaultConfig);
    }

    if (!config) {
      throw new Error('Could not find a .parcelrc');
    }

    this.#bundlerRunner = new BundlerRunner({
      options: resolvedOptions,
      config
    });

    this.#reporterRunner = new ReporterRunner({
      config,
      options: resolvedOptions
    });

    this.#assetGraphBuilder = new AssetGraphBuilder({
      options: resolvedOptions,
      config,
      entries: resolvedOptions.entries,
      targets: resolvedOptions.targets
    });

    this.#farm = await WorkerFarm.getShared(
      {
        config,
        options: resolvedOptions,
        env: resolvedOptions.env
      },
      {
        workerPath: require.resolve('./worker')
      }
    );

    await this.#assetGraphBuilder.initFarm();

    this.#runPackage = this.#farm.mkhandle('runPackage');
    this.#initialized = true;
  }

  async run(): Promise<IBundleGraph> {
    if (!this.#initialized) {
      await this.init();
    }

    let result = await this.build();

    let resolvedOptions = nullthrows(this.#resolvedOptions);
    if (resolvedOptions.killWorkers !== false) {
      await this.#farm.end();
    }

    if (result.type === 'buildFailure') {
      throw new BuildError(result.error);
    }

    return result.bundleGraph;
  }

  async watch(
    cb?: (err: ?Error, buildEvent?: BuildEvent) => mixed
  ): Promise<AsyncSubscription> {
    let watchEventsDisposable;
    if (cb) {
      watchEventsDisposable = this.#watchEvents.addListener(
        ({error, buildEvent}) => cb(error, buildEvent)
      );
    }

    if (this.#watcherCount === 0) {
      if (!this.#initialized) {
        await this.init();
      }

      this.#watcherSubscription = await this._getWatcherSubscription();
      await this.#reporterRunner.report({type: 'watchStart'});

      // Kick off a first build, but don't await its results. Its results will
      // be provided to the callback.
      this.build()
        .then(buildEvent => {
          this.#watchEvents.emit({buildEvent});
        })
        .catch(error => {
          // Ignore BuildAbortErrors and only emit critical errors.
          this.#watchEvents.emit({error});
        });
    }

    this.#watcherCount++;

    return {
      unsubscribe: async () => {
        if (watchEventsDisposable) {
          watchEventsDisposable.dispose();
        }

        this.#watcherCount--;
        if (this.#watcherCount === 0) {
          await nullthrows(this.#watcherSubscription).unsubscribe();
          this.#watcherSubscription = null;
          await this.#reporterRunner.report({type: 'watchEnd'});
        }
      }
    };
  }

  async build(): Promise<BuildEvent> {
    try {
      this.#reporterRunner.report({
        type: 'buildStart'
      });

      let startTime = Date.now();
      let {assetGraph, changedAssets} = await this.#assetGraphBuilder.build();
      dumpGraphToGraphViz(assetGraph, 'MainAssetGraph');

      let bundleGraph = await this.#bundlerRunner.bundle(assetGraph);
      dumpGraphToGraphViz(bundleGraph, 'BundleGraph');

      await packageBundles(bundleGraph, this.#runPackage);

      let event = {
        type: 'buildSuccess',
        changedAssets: new Map(
          Array.from(changedAssets).map(([id, asset]) => [id, new Asset(asset)])
        ),
        assetGraph: new MainAssetGraph(assetGraph),
        bundleGraph: new BundleGraph(bundleGraph),
        buildTime: Date.now() - startTime
      };
      this.#reporterRunner.report(event);

      return event;
    } catch (e) {
      if (e instanceof BuildAbortError) {
        throw e;
      }

      let event = {
        type: 'buildFailure',
        error: e
      };
      await this.#reporterRunner.report(event);
      return event;
    }
  }

  // $FlowFixMe
  async [INTERNAL_TRANSFORM]({
    filePath,
    env,
    code
  }: {
    filePath: FilePath,
    env: EnvironmentOpts,
    code?: string
  }) {
    let [result] = await Promise.all([
      this.#assetGraphBuilder.runTransform({
        filePath,
        code,
        env: new Environment(env)
      }),
      this.#reporterRunner.config.getReporters()
    ]);

    return result;
  }

  // $FlowFixMe
  async [INTERNAL_RESOLVE]({
    moduleSpecifier,
    sourcePath,
    env
  }: {
    moduleSpecifier: ModuleSpecifier,
    sourcePath: FilePath,
    env: EnvironmentOpts
  }): Promise<FilePath> {
    let resolved = await this.#assetGraphBuilder.resolverRunner.resolve(
      new Dependency({
        moduleSpecifier,
        sourcePath,
        env: new Environment(env)
      })
    );

    return resolved.filePath;
  }

  async _getWatcherSubscription(): Promise<AsyncSubscription> {
    invariant(this.#watcherSubscription == null);

    let resolvedOptions = nullthrows(this.#resolvedOptions);
    let targetDirs = resolvedOptions.targets.map(target =>
      path.resolve(target.distDir)
    );
    let cacheDir = path.resolve(resolvedOptions.cacheDir);
    let vcsDirs = ['.git', '.hg'].map(dir =>
      path.join(resolvedOptions.projectRoot, dir)
    );
    let ignore = [cacheDir, ...targetDirs, ...vcsDirs];

    return watcher.subscribe(
      resolvedOptions.projectRoot,
      async (err, events) => {
        if (err) {
          this.#watchEvents.emit({error: err});
          return;
        }

        this.#assetGraphBuilder.respondToFSEvents(events);
        if (this.#assetGraphBuilder.isInvalid()) {
          try {
            this.#watchEvents.emit({
              buildEvent: await this.build()
            });
          } catch (error) {
            // Ignore BuildAbortErrors and only emit critical errors.
            if (!(err instanceof BuildAbortError)) {
              this.#watchEvents.emit({error});
            }
          }
        }
      },
      {ignore}
    );
  }
}

function packageBundles(
  bundleGraph: InternalBundleGraph,
  runPackage: (
    bundle: Bundle,
    bundleGraph: InternalBundleGraph
  ) => Promise<Stats>
): Promise<mixed> {
  let promises = [];
  bundleGraph.traverseBundles(bundle => {
    promises.push(
      runPackage(bundle, bundleGraph).then(stats => {
        bundle.stats = stats;
      })
    );
  });

  return Promise.all(promises);
}

export class BuildError extends Error {
  name = 'BuildError';
  error: mixed;

  constructor(error: mixed) {
    super(error instanceof Error ? error.message : 'Unknown Build Error');
    this.error = error;
  }
}

export {default as Asset} from './Asset';
