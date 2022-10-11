// @flow strict-local
/* eslint-disable no-console */

import path from 'path';
import fs from 'fs';

export type CmdOptions = {|
  appRoot: string,
  dryRun: boolean,
  log: (...data: mixed[]) => void,
|};

export type ParsedArgs = {|
  dryRun: boolean,
  help: boolean,
|};

const defaultArgs: ParsedArgs = {
  dryRun: false,
  help: false,
};

export function printUsage(log: (...data: mixed[]) => void = console.log) {
  log('Usage: atlassian-parcel-link [--dry]');
  log('Options:');
  log('  --dry      Do not write any changes');
  log('  --help     Print this message');
}

export function parseArgs(args: Array<string>): ParsedArgs {
  const parsedArgs = {...defaultArgs};
  for (let arg of args) {
    switch (arg) {
      case '--dry':
        parsedArgs.dryRun = true;
        break;
      case '--help':
        parsedArgs.help = true;
        break;
      default:
        throw new Error(`Unknown argument: '${arg}'`);
    }
  }
  return parsedArgs;
}

export function validateAppRoot(appRoot: string) {
  try {
    fs.accessSync(path.join(appRoot, 'yarn.lock'));
  } catch (e) {
    throw new Error(`Not a root: '${appRoot}'`);
  }
}

export function validatePackageRoot(packageRoot: string) {
  try {
    fs.accessSync(path.join(packageRoot, 'core/core'));
  } catch (e) {
    throw new Error(`Not a package root: '${packageRoot}'`);
  }
}

export function fsWrite(
  f: string,
  content: string,
  {appRoot, log, dryRun}: CmdOptions,
) {
  log('Writing', path.join('<app>', path.relative(appRoot, f)));
  if (!dryRun) {
    fs.writeFileSync(f, content);
  }
}

export function fsDelete(f: string, {appRoot, log, dryRun}: CmdOptions) {
  log('Deleting', path.join('<app>', path.relative(appRoot, f)));
  if (!dryRun) {
    fs.rmSync(f, {recursive: true});
  }
}

export function fsSymlink(
  source: string,
  target: string,
  {appRoot, log, dryRun}: CmdOptions,
) {
  log(
    'Symlink',
    source,
    '->',
    path.join('<app>', path.relative(appRoot, target)),
  );
  if (!dryRun) {
    fs.symlinkSync(source, target);
  }
}

export function findParcelPackages(
  rootDir: string,
  files: Map<string, string> = new Map(),
): Map<string, string> {
  for (let file of fs.readdirSync(rootDir)) {
    if (file === 'node_modules') continue;
    let projectPath = path.join(rootDir, file);
    const stats = fs.statSync(projectPath);
    if (stats && stats.isDirectory()) {
      let packagePath = path.join(projectPath, 'package.json');
      if (fs.existsSync(packagePath)) {
        let pack = JSON.parse(fs.readFileSync(packagePath).toString());
        if (!pack.private) {
          files.set(pack.name, projectPath);
        }
      } else {
        findParcelPackages(projectPath, files);
      }
    }
  }
  return files;
}

export function mapAtlassianPackageAliases(
  parcelPackages: Map<string, string>,
): Map<string, string> {
  let atlassianToParcelPackages = new Map();
  for (let packageName of parcelPackages.keys()) {
    if (packageName.startsWith('@atlassian')) {
      continue;
    }
    atlassianToParcelPackages.set(
      packageName === 'parcel'
        ? '@atlassian/parcel'
        : packageName === 'parcelforvscode'
        ? '@atlassian/parcelforvscode'
        : packageName.replace(/^@parcel\//, '@atlassian/parcel-'),
      packageName,
    );
  }
  return atlassianToParcelPackages;
}

export function cleanupNodeModules(
  root: string,
  predicate: (filepath: string) => boolean,
  opts: CmdOptions,
) {
  for (let dirName of fs.readdirSync(root)) {
    let dirPath = path.join(root, dirName);
    if (dirName === '.bin') {
      let binSymlink = path.join(root, '.bin/parcel');
      try {
        fs.accessSync(binSymlink);
        // no access error, exists
        fsDelete(binSymlink, opts);
      } catch (e) {
        // noop
      }
      continue;
    }
    if (dirName[0].startsWith('@')) {
      cleanupNodeModules(dirPath, predicate, opts);
      continue;
    }

    let packageName;
    let parts = dirPath.split(path.sep).slice(-2);
    if (parts[0].startsWith('@')) {
      packageName = parts.join('/');
    } else {
      packageName = parts[1];
    }

    // -------

    if (predicate(packageName)) {
      fsDelete(dirPath, opts);
    }

    // -------

    let packageNodeModules = path.join(root, dirName, 'node_modules');
    let stat;
    try {
      stat = fs.statSync(packageNodeModules);
    } catch (e) {
      // noop
    }
    if (stat?.isDirectory()) {
      cleanupNodeModules(packageNodeModules, predicate, opts);
    }
  }
}
