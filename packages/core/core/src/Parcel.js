// @flow strict-local

import type {
  AsyncSubscription,
  BundleGraph as IBundleGraph,
  BuildEvent,
  EnvironmentOpts,
  FilePath,
  InitialParcelOptions,
  ModuleSpecifier
} from '@parcel/types';
import type {ParcelOptions} from './types';
import type {FarmOptions} from '@parcel/workers';
import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';

import invariant from 'assert';
import {createDependency} from './Dependency';
import {createEnvironment} from './Environment';
import {assetFromValue} from './public/Asset';
import BundleGraph from './public/BundleGraph';
import BundlerRunner from './BundlerRunner';
import WorkerFarm from '@parcel/workers';
import nullthrows from 'nullthrows';
import path from 'path';
import AssetGraphBuilder from './AssetGraphBuilder';
import {assertSignalNotAborted, BuildAbortError} from './utils';
import PackagerRunner from './PackagerRunner';
import loadParcelConfig from './loadParcelConfig';
import ReporterRunner from './ReporterRunner';
import dumpGraphToGraphViz from './dumpGraphToGraphViz';
import resolveOptions from './resolveOptions';
import {ValueEmitter} from '@parcel/events';
import registerCoreWithSerializer from './registerCoreWithSerializer';
import {createCacheDir} from '@parcel/cache';
import {AbortController} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import {PromiseQueue} from '@parcel/utils';

registerCoreWithSerializer();

export const INTERNAL_TRANSFORM = Symbol('internal_transform');
export const INTERNAL_RESOLVE = Symbol('internal_resolve');

export default class Parcel {
  #assetGraphBuilder; // AssetGraphBuilder
  #runtimesAssetGraphBuilder; // AssetGraphBuilder
  #bundlerRunner; // BundlerRunner
  #packagerRunner; // PackagerRunner
  #config;
  #farm; // WorkerFarm
  #initialized = false; // boolean
  #initialOptions; // InitialParcelOptions;
  #reporterRunner; // ReporterRunner
  #resolvedOptions = null; // ?ParcelOptions
  #runPackage; // (bundle: IBundle, bundleGraph: InternalBundleGraph) => Promise<Stats>;
  #watchAbortController; // AbortController
  #watchQueue = new PromiseQueue<?BuildEvent>({maxConcurrent: 1}); // PromiseQueue<?BuildEvent>
  #watchEvents = new ValueEmitter<
    | {
        +error: Error,
        +buildEvent?: void,
        ...
      }
    | {
        +buildEvent: BuildEvent,
        +error?: void,
        ...
      }
  >();
  #watcherSubscription; // AsyncSubscription
  #watcherCount = 0; // number

  constructor(options: InitialParcelOptions) {
    this.#initialOptions = options;
  }

  async init(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    let resolvedOptions: ParcelOptions = await resolveOptions(
      this.#initialOptions
    );
    this.#resolvedOptions = resolvedOptions;
    await createCacheDir(resolvedOptions.outputFS, resolvedOptions.cacheDir);

    let {config} = await loadParcelConfig(
      path.join(resolvedOptions.inputFS.cwd(), 'index'),
      resolvedOptions
    );
    this.#config = config;
    this.#farm =
      this.#initialOptions.workerFarm ??
      createWorkerFarm({
        patchConsole: resolvedOptions.patchConsole
      });

    this.#assetGraphBuilder = new AssetGraphBuilder();
    this.#runtimesAssetGraphBuilder = new AssetGraphBuilder();

    await Promise.all([
      this.#assetGraphBuilder.init({
        name: 'MainAssetGraph',
        options: resolvedOptions,
        config,
        entries: resolvedOptions.entries,
        workerFarm: this.#farm
      }),
      this.#runtimesAssetGraphBuilder.init({
        name: 'RuntimesAssetGraph',
        options: resolvedOptions,
        config,
        workerFarm: this.#farm
      })
    ]);

    this.#bundlerRunner = new BundlerRunner({
      options: resolvedOptions,
      runtimesBuilder: this.#runtimesAssetGraphBuilder,
      config,
      workerFarm: this.#farm
    });

    this.#reporterRunner = new ReporterRunner({
      config,
      options: resolvedOptions
    });

    this.#packagerRunner = new PackagerRunner({
      config,
      options: resolvedOptions,
      farm: this.#farm
    });

    this.#runPackage = this.#farm.createHandle('runPackage');
    this.#initialized = true;
  }

  async run(): Promise<IBundleGraph> {
    let startTime = Date.now();
    if (!this.#initialized) {
      await this.init();
    }

    let result = await this.build({startTime});
    await Promise.all([
      this.#assetGraphBuilder.writeToCache(),
      this.#runtimesAssetGraphBuilder.writeToCache()
    ]);

    if (!this.#initialOptions.workerFarm) {
      // If there wasn't a workerFarm passed in, we created it. End the farm.
      await this.#farm.end();
    }

    if (result.type === 'buildFailure') {
      throw new BuildError(result.error);
    }

    return result.bundleGraph;
  }

  async startNextBuild() {
    this.#watchAbortController = new AbortController();

    try {
      this.#watchEvents.emit({
        buildEvent: await this.build({
          signal: this.#watchAbortController.signal
        })
      });
    } catch (err) {
      // Ignore BuildAbortErrors and only emit critical errors.
      if (!(err instanceof BuildAbortError)) {
        throw err;
      }
    }
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
      this.#watchQueue.add(() => this.startNextBuild());
      this.#watchQueue.run();
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
          await Promise.all([
            this.#assetGraphBuilder.writeToCache(),
            this.#runtimesAssetGraphBuilder.writeToCache()
          ]);
        }
      }
    };
  }

  async build({
    signal,
    startTime = Date.now()
  }: {|
    signal?: AbortSignal,
    startTime?: number
  |}): Promise<BuildEvent> {
    let options = nullthrows(this.#resolvedOptions);
    try {
      if (options.profile) {
        await this.#farm.startProfile();
      }

      this.#reporterRunner.report({
        type: 'buildStart'
      });

      let {assetGraph, changedAssets} = await this.#assetGraphBuilder.build();
      dumpGraphToGraphViz(assetGraph, 'MainAssetGraph');

      let bundleGraph = await this.#bundlerRunner.bundle(assetGraph, {signal});
      dumpGraphToGraphViz(bundleGraph._graph, 'BundleGraph');

      await this.#packagerRunner.writeBundles(bundleGraph);
      assertSignalNotAborted(signal);

      let event = {
        type: 'buildSuccess',
        changedAssets: new Map(
          Array.from(changedAssets).map(([id, asset]) => [
            id,
            assetFromValue(asset, options)
          ])
        ),
        bundleGraph: new BundleGraph(bundleGraph, options),
        buildTime: Date.now() - startTime
      };
      this.#reporterRunner.report(event);

      await this.#assetGraphBuilder.validate();
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
    } finally {
      if (options.profile) {
        await this.#farm.endProfile();
      }
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
    code?: string,
    ...
  }) {
    let [result] = await Promise.all([
      this.#assetGraphBuilder.runTransform({
        filePath,
        code,
        env: createEnvironment(env)
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
    env: EnvironmentOpts,
    ...
  }): Promise<FilePath> {
    let resolved = await this.#assetGraphBuilder.resolverRunner.resolve(
      createDependency({
        moduleSpecifier,
        sourcePath,
        env: createEnvironment(env)
      })
    );

    return resolved.filePath;
  }

  _getWatcherSubscription(): Promise<AsyncSubscription> {
    invariant(this.#watcherSubscription == null);

    let resolvedOptions = nullthrows(this.#resolvedOptions);
    let opts = this.#assetGraphBuilder.getWatcherOptions();

    return resolvedOptions.inputFS.watch(
      resolvedOptions.projectRoot,
      (err, _events) => {
        let events = _events.filter(e => !e.path.includes('.cache'));

        if (err) {
          this.#watchEvents.emit({error: err});
          return;
        }

        let isInvalid = this.#assetGraphBuilder.respondToFSEvents(events);
        if (isInvalid && this.#watchQueue.getNumWaiting() === 0) {
          if (this.#watchAbortController) {
            this.#watchAbortController.abort();
          }

          this.#watchQueue.add(() => this.startNextBuild());
          this.#watchQueue.run();
        }
      },
      opts
    );
  }
}

export class BuildError extends Error {
  name = 'BuildError';
  error: mixed;

  constructor(error: mixed) {
    super(error instanceof Error ? error.message : 'Unknown Build Error');
    this.error = error;
    if (error instanceof Error) {
      this.stack = error.stack;
    }
  }
}

export {default as Asset} from './InternalAsset';

export function createWorkerFarm(options: $Shape<FarmOptions> = {}) {
  return new WorkerFarm({
    ...options,
    workerPath: require.resolve('./worker')
  });
}
