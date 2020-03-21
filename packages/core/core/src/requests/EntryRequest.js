// @flow strict-local
import type {FileSystem} from '@parcel/fs';
import type {FilePath, File} from '@parcel/types';
import type {StaticRunOpts, RequestRunnerOpts} from '../RequestTracker';
import type {Entry, ParcelOptions} from '../types';

import {isGlob, glob} from '@parcel/utils';
import path from 'path';
import {RequestRunner} from '../RequestTracker';

export type EntryRequest = {|
  id: string,
  +type: 'entry_request',
  request: FilePath,
  result?: EntryResult,
|};

type EntryResult = {|
  entries: Array<Entry>,
  files: Array<File>,
|};

type RunOpts = {|
  request: FilePath,
  ...StaticRunOpts,
|};

// export default function createEntryRequest(opts: EntryRequestOpts) {
//   return new EntryRequestRunner(opts);
// }

export default class EntryRequestRunner extends RequestRunner<
  FilePath,
  EntryResult,
> {
  constructor(opts: RequestRunnerOpts) {
    super(opts);
    this.type = 'entry_request';
  }

  async run({request, api, options}: RunOpts) {
    let entryResolver = new EntryResolver(options);
    let result = await entryResolver.resolveEntry(request);

    // Connect files like package.json that affect the entry
    // resolution so we invalidate when they change.
    for (let file of result.files) {
      api.invalidateOnFileUpdate(file.filePath);
    }

    // If the entry specifier is a glob, add a glob node so
    // we invalidate when a new file matches.
    if (isGlob(request)) {
      api.invalidateOnFileCreate(request);
    }

    return result;
  }
}

class EntryResolver {
  fs: FileSystem;

  constructor(options: ParcelOptions) {
    this.fs = options.inputFS;
  }

  async resolveEntry(entry: FilePath): Promise<EntryResult> {
    if (isGlob(entry)) {
      let files = await glob(entry, this.fs, {
        absolute: true,
        onlyFiles: false,
      });
      let results = await Promise.all(files.map(f => this.resolveEntry(f)));
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
      stat = await this.fs.stat(entry);
    } catch (err) {
      throw new Error(`Entry ${entry} does not exist`);
    }

    if (stat.isDirectory()) {
      let pkg = await this.readPackage(entry);
      if (pkg && typeof pkg.source === 'string') {
        let source = path.join(path.dirname(pkg.filePath), pkg.source);
        try {
          stat = await this.fs.stat(source);
        } catch (err) {
          throw new Error(
            `${pkg.source} in ${path.relative(
              this.fs.cwd(),
              pkg.filePath,
            )}#source does not exist`,
          );
        }

        if (!stat.isFile()) {
          throw new Error(
            `${pkg.source} in ${path.relative(
              this.fs.cwd(),
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
      return {
        entries: [{filePath: entry}],
        files: [],
      };
    }

    throw new Error(`Unknown entry ${entry}`);
  }

  async readPackage(entry: FilePath) {
    let content, pkg;
    let pkgFile = path.join(entry, 'package.json');
    try {
      content = await this.fs.readFile(pkgFile, 'utf8');
    } catch (err) {
      return null;
    }

    try {
      pkg = JSON.parse(content);
    } catch (err) {
      throw new Error(
        `Error parsing ${path.relative(this.fs.cwd(), pkgFile)}: ${
          err.message
        }`,
      );
    }

    pkg.filePath = pkgFile;
    return pkg;
  }
}
