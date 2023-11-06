// @flow strict-local

import assert from 'assert';
import child_process from 'child_process';
import path from 'path';

import type {FileSystem} from '@parcel/fs';

export type CmdOptions = {|
  appRoot: string,
  packageRoot: string,
  dryRun: boolean,
  fs: FileSystem,
  log: (...data: mixed[]) => void,
|};

export async function fsWrite(
  f: string,
  content: string,
  {appRoot, log, dryRun, fs}: CmdOptions,
): Promise<void> {
  if (!dryRun) await fs.writeFile(f, content);
  log('Wrote', path.join('<app>', path.relative(appRoot, f)));
}

export async function fsDelete(
  f: string,
  {appRoot, log, dryRun, fs}: CmdOptions,
): Promise<void> {
  if (await fs.exists(f)) {
    if (!dryRun) await fs.rimraf(f);
    log('Deleted', path.join('<app>', path.relative(appRoot, f)));
  }
}

export async function fsSymlink(
  source: string,
  target: string,
  {appRoot, packageRoot, log, dryRun, fs}: CmdOptions,
): Promise<void> {
  if (!dryRun) {
    assert(
      await fs.exists(source),
      `Can't link from ${source}; it doesn't exist!`,
    );
    assert(
      !(await fs.exists(target)),
      `Can't link to ${target}; it already exists!`,
    );
    await fs.symlink(source, target);
  }
  log(
    'Linked',
    path.join('<app>', path.relative(appRoot, target)),
    '->',
    path.join('<pkg>', path.relative(packageRoot, source)),
  );
}

export async function findParcelPackages(
  fs: FileSystem,
  rootDir: string,
  files: Map<string, string> = new Map(),
): Promise<Map<string, string>> {
  for (let file of fs.readdirSync(rootDir, {withFileTypes: true})) {
    if (file.name === 'node_modules') continue;
    let projectPath = path.join(rootDir, file.name);
    if (file.isDirectory()) {
      let packagePath = path.join(projectPath, 'package.json');
      if (fs.existsSync(packagePath)) {
        let pack = JSON.parse(await fs.readFile(packagePath, 'utf8'));
        if (!pack.private) {
          files.set(pack.name, projectPath);
        }
      } else {
        await findParcelPackages(fs, projectPath, files);
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

export async function cleanupBin(root: string, opts: CmdOptions) {
  let binSymlink = path.join(root, '.bin/parcel');
  try {
    await fsDelete(binSymlink, opts);
  } catch (e) {
    // noop
  }
}

export async function cleanupNodeModules(
  root: string,
  predicate: (filepath: string) => boolean,
  opts: CmdOptions,
): Promise<void> {
  let {fs} = opts;
  for (let dirName of fs.readdirSync(root)) {
    if (dirName === '.bin') continue;
    let dirPath = path.join(root, dirName);
    if (dirName[0].startsWith('@')) {
      await cleanupNodeModules(dirPath, predicate, opts);
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
      await fsDelete(dirPath, opts);
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
      await cleanupNodeModules(packageNodeModules, predicate, opts);
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
