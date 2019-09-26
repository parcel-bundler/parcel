// @flow
import type {FileSystem} from '@parcel/fs';
import type {FilePath} from '@parcel/types';
import type {ParcelOptions} from './types';
import path from 'path';

export class EntryResolver {
  fs: FileSystem;
  options: ParcelOptions;

  constructor(fs: FileSystem, options: ParcelOptions) {
    this.fs = fs;
    this.options = options;
  }

  async resolveEntry(entry: FilePath) {
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
          entryFiles: [source],
          connectedFiles: [pkg.filePath]
        };
      }

      throw new Error(`Could not find entry: ${entry}`);
    } else if (stat.isFile()) {
      return {
        entryFiles: [entry],
        connectedFiles: []
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
