// @flow strict-local

import type {
  FilePath,
  InitialParcelOptions,
  ParcelOptions
} from '@parcel/types';

import TargetResolver from './TargetResolver';
import Environment from './Environment';
import getRootDir from '@parcel/utils/src/getRootDir';
import loadEnv from './loadEnv';
import path from 'path';

// Default cache directory name
const DEFAULT_CACHE_DIR = '.parcel-cache';

export default async function resolveOptions(
  initialOptions: InitialParcelOptions
): Promise<ParcelOptions> {
  let entries: Array<FilePath>;
  if (initialOptions.entries == null || initialOptions.entries === '') {
    entries = [];
  } else if (Array.isArray(initialOptions.entries)) {
    entries = initialOptions.entries;
  } else {
    entries = [initialOptions.entries];
  }

  let rootDir =
    initialOptions.rootDir != null
      ? initialOptions.rootDir
      : getRootDir(entries);

  let targetResolver = new TargetResolver();
  let resolvedTargets = await targetResolver.resolve(rootDir);

  let serveOptions = initialOptions.serve || initialOptions.hot;
  let targets;
  if (initialOptions.targets) {
    if (initialOptions.targets.length === 0) {
      throw new Error('Targets was an empty array');
    }

    targets = initialOptions.targets.map(target => {
      if (typeof target === 'string') {
        let matchingTarget = resolvedTargets.get(target);
        if (!matchingTarget) {
          throw new Error(`Could not find target with name ${target}`);
        }
        return matchingTarget;
      }

      return target;
    });

    if (serveOptions) {
      // In serve mode, we only support a single browser target. If the user
      // provided more than one, or the matching target is not a browser, throw.
      if (targets.length > 1) {
        throw new Error('More than one target is not supported in serve mode');
      }
      if (targets[0].env.context !== 'browser') {
        throw new Error('Only browser targets are supported in serve mode');
      }
    }
  } else {
    // Explicit targets were not provided
    if (serveOptions) {
      // In serve mode, we only support a single browser target. Since the user
      // hasn't specified a target, use one targeting modern browsers for development
      targets = [
        {
          name: 'default',
          distDir: 'dist',
          publicUrl:
            serveOptions && serveOptions.publicUrl != null
              ? serveOptions.publicUrl
              : '/',
          env: new Environment({
            context: 'browser',
            engines: {
              browsers: [
                'last 1 Chrome version',
                'last 1 Safari version',
                'last 1 Firefox version',
                'last 1 Edge version'
              ]
            }
          })
        }
      ];
    } else {
      targets = Array.from(resolvedTargets.values());
    }
  }

  if (!initialOptions.env) {
    await loadEnv(path.join(rootDir, 'index'));
  }

  let cacheDir =
    initialOptions.cacheDir != null
      ? initialOptions.cacheDir
      : DEFAULT_CACHE_DIR;

  // $FlowFixMe
  return {
    env: process.env,
    ...initialOptions,
    cacheDir,
    entries,
    rootDir,
    targets
  };
}
