// @flow strict-local

import path from 'path';
import fs from 'fs';
import child_process from 'child_process';

export type CmdOptions = {|
  appRoot: string,
  packageRoot: string,
  dryRun: boolean,
  log: (...data: mixed[]) => void,
|};

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

export function mapNamespacePackageAliases(
  ns: string,
  parcelPackages: Map<string, string>,
): Map<string, string> {
  let aliasesToParcelPackages = new Map();
  for (let packageName of parcelPackages.keys()) {
    if (packageName.startsWith(ns)) {
      continue;
    }
    aliasesToParcelPackages.set(
      packageName === 'parcel'
        ? `${ns}/parcel`
        : packageName === 'parcelforvscode'
        ? `${ns}/parcelforvscode`
        : packageName.replace(/^@parcel\//, `${ns}/parcel-`),
      packageName,
    );
  }
  return aliasesToParcelPackages;
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

export function execSync(
  cmd: string,
  {appRoot, log, dryRun}: CmdOptions,
): void {
  log('Executing', cmd);
  if (!dryRun) {
    child_process.execSync(cmd, {cwd: appRoot, stdio: 'inherit'});
  }
}
