// @flow strict-local

import type {Async, FilePath, File} from '@parcel/types';
import type {StaticRunOpts} from '../RequestTracker';
import type {Entry, ParcelOptions} from '../types';

import {isDirectoryInside, isGlob, glob} from '@parcel/utils';
import path from 'path';

type RunOpts = {|
  input: FilePath,
  ...StaticRunOpts<EntryResult>,
|};

export type EntryRequest = {|
  id: string,
  +type: 'entry_request',
  run: RunOpts => Async<EntryResult>,
  input: FilePath,
|};

export type EntryResult = {|
  entries: Array<Entry>,
  files: Array<File>,
|};

const type = 'entry_request';

export default function createEntryRequest(input: FilePath): EntryRequest {
  return {
    id: `${type}:${input}`,
    type,
    run,
    input,
  };
}

async function run({input, api, options}: RunOpts): Promise<EntryResult> {
  let entryResolver = new EntryResolver(options);
  let result = await entryResolver.resolveEntry(input);

  // Connect files like package.json that affect the entry
  // resolution so we invalidate when they change.
  for (let file of result.files) {
    api.invalidateOnFileUpdate(file.filePath);
    api.invalidateOnFileDelete(file.filePath);
  }

  // If the entry specifier is a glob, add a glob node so
  // we invalidate when a new file matches.
  if (isGlob(input)) {
    api.invalidateOnFileCreate(input);
  }

  // Invalidate whenever an entry is deleted.
  // If the entry was a glob, we'll re-evaluate it, and otherwise
  // a proper entry error will be thrown.
  for (let entry of result.entries) {
    api.invalidateOnFileDelete(entry.filePath);
  }

  return result;
}

class EntryResolver {
  options: ParcelOptions;

  constructor(options: ParcelOptions) {
    this.options = options;
  }

  async resolveEntry(entry: FilePath): Promise<EntryResult> {
    if (isGlob(entry)) {
      let files = await glob(entry, this.options.inputFS, {
        absolute: true,
        onlyFiles: false,
      });
      let results = await Promise.all(
        files.map(f => this.resolveEntry(path.normalize(f))),
      );
      return results.reduce(
        (p, res) => ({
          entries: p.entries.concat(res.entries),
          files: p.files.concat(res.files),
        }),
        {entries: [], files: []},
      );
    }

    let stat;
    try {
      stat = await this.options.inputFS.stat(entry);
    } catch (err) {
      throw new Error(`Entry ${entry} does not exist`);
    }

    if (stat.isDirectory()) {
      let pkg = await this.readPackage(entry);
      if (pkg && typeof pkg.source === 'string') {
        let source = path.join(path.dirname(pkg.filePath), pkg.source);
        try {
          stat = await this.options.inputFS.stat(source);
        } catch (err) {
          throw new Error(
            `${pkg.source} in ${path.relative(
              this.options.inputFS.cwd(),
              pkg.filePath,
            )}#source does not exist`,
          );
        }

        if (!stat.isFile()) {
          throw new Error(
            `${pkg.source} in ${path.relative(
              this.options.inputFS.cwd(),
              pkg.filePath,
            )}#source is not a file`,
          );
        }

        return {
          entries: [{filePath: source, packagePath: entry}],
          files: [{filePath: pkg.filePath}],
        };
      }

      throw new Error(`Could not find entry: ${entry}`);
    } else if (stat.isFile()) {
      let projectRoot = this.options.projectRoot;
      let packagePath = isDirectoryInside(
        this.options.inputFS.cwd(),
        projectRoot,
      )
        ? this.options.inputFS.cwd()
        : projectRoot;

      return {
        entries: [{filePath: entry, packagePath: packagePath}],
        files: [],
      };
    }

    throw new Error(`Unknown entry ${entry}`);
  }

  async readPackage(entry: FilePath) {
    let content, pkg;
    let pkgFile = path.join(entry, 'package.json');
    try {
      content = await this.options.inputFS.readFile(pkgFile, 'utf8');
    } catch (err) {
      return null;
    }

    try {
      pkg = JSON.parse(content);
    } catch (err) {
      throw new Error(
        `Error parsing ${path.relative(this.options.inputFS.cwd(), pkgFile)}: ${
          err.message
        }`,
      );
    }

    pkg.filePath = pkgFile;
    return pkg;
  }
}
