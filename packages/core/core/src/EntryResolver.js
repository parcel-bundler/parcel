// @flow
import type {FileSystem} from '@parcel/fs';
import type {FilePath, File} from '@parcel/types';
import type {ParcelOptions} from './types';
import path from 'path';
import {isGlob, glob} from '@parcel/utils';

export type EntryResult = {|
  entries: Array<FilePath>,
  files: Array<File>
|};

export class EntryResolver {
  fs: FileSystem;

  constructor(options: ParcelOptions) {
    this.fs = options.inputFS;
  }

  async resolveEntry(entry: FilePath): Promise<EntryResult> {
    if (isGlob(entry)) {
      let files = await glob(entry, this.fs, {
        absolute: true,
        onlyFiles: false
      });
      let results = await Promise.all(files.map(f => this.resolveEntry(f)));
      return results.reduce(
        (p, res) => ({
          entries: p.entries.concat(res.entries),
          files: p.files.concat(res.files)
        }),
        {entries: [], files: []}
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
              pkg.filePath
            )}#source does not exist`
          );
        }

        if (!stat.isFile()) {
          throw new Error(
            `${pkg.source} in ${path.relative(
              this.fs.cwd(),
              pkg.filePath
            )}#source is not a file`
          );
        }

        return {
          entries: [source],
          files: [{filePath: pkg.filePath}]
        };
      }

      throw new Error(`Could not find entry: ${entry}`);
    } else if (stat.isFile()) {
      return {
        entries: [entry],
        files: []
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
        `Error parsing ${path.relative(this.fs.cwd(), pkgFile)}: ${err.message}`
      );
    }

    pkg.filePath = pkgFile;
    return pkg;
  }
}
