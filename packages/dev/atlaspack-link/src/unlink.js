// @flow strict-local

import type {CmdOptions} from './utils';
import type {FileSystem} from '@atlaspack/fs';

import {AtlaspackLinkConfig} from './AtlaspackLinkConfig';
import {
  cleanupBin,
  cleanupNodeModules,
  execSync,
  findAtlaspackPackages,
  fsWrite,
  mapNamespacePackageAliases,
} from './utils';

import path from 'path';
import {NodeFS} from '@atlaspack/fs';
import commander from 'commander';

export type UnlinkOptions = {|
  dryRun?: boolean,
  forceInstall?: boolean,
  log?: (...data: mixed[]) => void,
|};

export type UnlinkCommandOptions = {|
  +unlink?: typeof unlink,
  +fs?: FileSystem,
  +log?: (...data: mixed[]) => void,
|};

const NOOP: (...data: mixed[]) => void = () => {};

export async function unlink(
  config: AtlaspackLinkConfig,
  {dryRun = false, forceInstall = false, log = NOOP}: UnlinkOptions,
) {
  config.validate();

  let {appRoot, packageRoot, namespace} = config;

  let nodeModulesPaths = config.getNodeModulesPaths();

  let opts: CmdOptions = {appRoot, packageRoot, dryRun, log, fs: config.fs};

  // Step 1: Determine all Atlaspack packages that could be linked
  // --------------------------------------------------------------------------------

  let atlaspackPackages = await findAtlaspackPackages(config.fs, packageRoot);

  // Step 2: Delete all official packages (`@atlaspack/*`) from node_modules
  // This is very brute-force, but should ensure that we catch all linked packages.
  // --------------------------------------------------------------------------------

  for (let nodeModules of nodeModulesPaths) {
    await cleanupBin(nodeModules, opts);
    await cleanupNodeModules(
      nodeModules,
      packageName => atlaspackPackages.has(packageName),
      opts,
    );
  }

  // Step 3 (optional): If a namespace is not "@atlaspack", restore all aliased references.
  // --------------------------------------------------------------------------------

  if (namespace != null && namespace !== '@atlaspack') {
    // Step 3.1: Determine all namespace packages that could be aliased
    // --------------------------------------------------------------------------------

    let namespacePackages = mapNamespacePackageAliases(
      namespace,
      atlaspackPackages,
    );

    // Step 3.2: In .atlaspackrc, restore all references to namespaced plugins.
    // --------------------------------------------------------------------------------

    let atlaspackConfigPath = path.join(appRoot, '.atlaspackrc');
    if (config.fs.existsSync(atlaspackConfigPath)) {
      let atlaspackConfig = config.fs.readFileSync(atlaspackConfigPath, 'utf8');
      for (let [alias, atlaspack] of namespacePackages) {
        atlaspackConfig = atlaspackConfig.replace(
          new RegExp(`"${atlaspack}"`, 'g'),
          `"${alias}"`,
        );
      }
      await fsWrite(atlaspackConfigPath, atlaspackConfig, opts);
    }

    // Step 3.3: In the root package.json, restore all references to namespaced plugins
    // For configs like "@namespace/parcel-bundler-default":{"maxParallelRequests": 10}
    // --------------------------------------------------------------------------------

    let rootPkgPath = path.join(appRoot, 'package.json');
    if (config.fs.existsSync(rootPkgPath)) {
      let rootPkg = config.fs.readFileSync(rootPkgPath, 'utf8');
      for (let [alias, atlaspack] of namespacePackages) {
        rootPkg = rootPkg.replace(
          new RegExp(`"${atlaspack}"(\\s*:\\s*{)`, 'g'),
          `"${alias}"$1`,
        );
      }
      await fsWrite(rootPkgPath, rootPkg, opts);
    }

    // Step 3.4: Delete all namespaced packages (`@namespace/parcel-*`) from node_modules
    // This is very brute-force, but should ensure that we catch all linked packages.
    // --------------------------------------------------------------------------------

    for (let nodeModules of nodeModulesPaths) {
      await cleanupNodeModules(
        nodeModules,
        packageName => namespacePackages.has(packageName),
        opts,
      );
    }
  }

  // Step 4 (optional): Run `yarn` to restore all dependencies.
  // --------------------------------------------------------------------------------

  if (forceInstall) {
    // FIXME: This should detect the package manager in use.
    log('Running `yarn` to restore dependencies');
    execSync('yarn install --force', opts);
  } else {
    log('Run `yarn install --force` (or similar) to restore dependencies');
  }
}

export function createUnlinkCommand(
  opts?: UnlinkCommandOptions,
  // $FlowFixMe[invalid-exported-annotation]
): commander.Command {
  let action = opts?.unlink ?? unlink;
  let log = opts?.log ?? NOOP;
  let fs = opts?.fs ?? new NodeFS();

  return new commander.Command('unlink')
    .description('Unlink a dev copy of Atlaspack from an app')
    .option('-d, --dry-run', 'Do not write any changes')
    .option('-f, --force-install', 'Force a reinstall after unlinking')
    .action(async options => {
      if (options.dryRun) log('Dry run...');
      let appRoot = process.cwd();

      let atlaspackLinkConfig;
      try {
        atlaspackLinkConfig = await AtlaspackLinkConfig.load(appRoot, {fs});
      } catch (e) {
        // boop!
      }

      if (atlaspackLinkConfig) {
        await action(atlaspackLinkConfig, {
          dryRun: options.dryRun,
          forceInstall: options.forceInstall,
          log,
        });

        if (!options.dryRun) await atlaspackLinkConfig.delete();
      } else {
        throw new Error('A Atlaspack link could not be found!');
      }

      log('🎉 Unlinking successful');
    });
}
