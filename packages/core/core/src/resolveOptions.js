// @flow strict-local

import type {FilePath, InitialParcelOptions} from '@parcel/types';
import type {ParcelOptions} from './types';

import {getRootDir} from '@parcel/utils';
import loadDotEnv from './loadDotEnv';
import path from 'path';
import {resolveConfig, md5FromString} from '@parcel/utils';
import {NodeFS} from '@parcel/fs';
import Cache from '@parcel/cache';
import {NodePackageManager} from '@parcel/package-manager';

// Default cache directory name
const DEFAULT_CACHE_DIRNAME = '.parcel-cache';
const LOCK_FILE_NAMES = ['yarn.lock', 'package-lock.json', 'pnpm-lock.yaml'];

// Generate a unique instanceId, will change on every run of parcel
function generateInstanceId(entries: Array<FilePath>): string {
  return md5FromString(
    `${entries.join(',')}-${Date.now()}-${Math.round(Math.random() * 100)}`,
  );
}

export default async function resolveOptions(
  initialOptions: InitialParcelOptions,
): Promise<ParcelOptions> {
  let entries: Array<FilePath>;
  if (initialOptions.entries == null || initialOptions.entries === '') {
    entries = [];
  } else if (Array.isArray(initialOptions.entries)) {
    entries = initialOptions.entries.map(entry => path.resolve(entry));
  } else {
    entries = [path.resolve(initialOptions.entries)];
  }

  let inputFS = initialOptions.inputFS || new NodeFS();
  let outputFS = initialOptions.outputFS || new NodeFS();

  let packageManager =
    initialOptions.packageManager || new NodePackageManager(inputFS);

  let rootDir =
    initialOptions.rootDir != null
      ? path.resolve(initialOptions.rootDir)
      : getRootDir(entries);

  let projectRootFile =
    (await resolveConfig(inputFS, path.join(rootDir, 'index'), [
      ...LOCK_FILE_NAMES,
      '.git',
      '.hg',
    ])) || path.join(inputFS.cwd(), 'index'); // ? Should this just be rootDir

  let lockFile = null;
  let rootFileName = path.basename(projectRootFile);
  if (LOCK_FILE_NAMES.includes(rootFileName)) {
    lockFile = projectRootFile;
  }
  let projectRoot = path.dirname(projectRootFile);

  let inputCwd = inputFS.cwd();
  let outputCwd = outputFS.cwd();

  let cacheDir =
    // If a cacheDir is provided, resolve it relative to cwd. Otherwise,
    // use a default directory resolved relative to the project root.
    initialOptions.cacheDir != null
      ? path.resolve(outputCwd, initialOptions.cacheDir)
      : path.resolve(projectRoot, DEFAULT_CACHE_DIRNAME);

  let cache = new Cache(outputFS, cacheDir);

  let mode = initialOptions.mode ?? 'development';
  let minify = initialOptions.minify ?? mode === 'production';

  let detailedReport: number = 0;
  if (initialOptions.detailedReport != null) {
    detailedReport =
      initialOptions.detailedReport === true
        ? 10
        : parseInt(initialOptions.detailedReport, 10);
  }

  let publicUrl = initialOptions.publicUrl ?? '/';
  let distDir =
    initialOptions.distDir != null
      ? path.resolve(inputCwd, initialOptions.distDir)
      : undefined;

  return {
    config: initialOptions.config,
    defaultConfig: initialOptions.defaultConfig,
    patchConsole:
      initialOptions.patchConsole ?? process.env.NODE_ENV !== 'test',
    env: {
      ...initialOptions.env,
      ...(await loadDotEnv(
        initialOptions.env ?? {},
        inputFS,
        path.join(projectRoot, 'index'),
      )),
    },
    mode,
    minify,
    autoinstall: initialOptions.autoinstall ?? true,
    hot: initialOptions.hot ?? null,
    contentHash:
      initialOptions.contentHash ?? initialOptions.mode === 'production',
    serve: initialOptions.serve
      ? {
          ...initialOptions.serve,
          distDir: distDir ?? path.join(outputCwd, 'dist'),
        }
      : false,
    disableCache: initialOptions.disableCache ?? false,
    killWorkers: initialOptions.killWorkers ?? true,
    profile: initialOptions.profile ?? false,
    cacheDir,
    entries,
    rootDir,
    defaultEngines: initialOptions.defaultEngines,
    targets: initialOptions.targets,
    sourceMaps: initialOptions.sourceMaps ?? true,
    scopeHoist:
      initialOptions.scopeHoist ?? initialOptions.mode === 'production',
    publicUrl,
    distDir,
    logLevel: initialOptions.logLevel ?? 'info',
    projectRoot,
    lockFile,
    inputFS,
    outputFS,
    cache,
    packageManager,
    instanceId: generateInstanceId(entries),
    detailedReport,
  };
}
