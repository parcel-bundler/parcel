// @flow
import type {FilePath, File} from '@parcel/types';
import type {Entry, ParcelOptions} from './types';
import path from 'path';
import {isDirectoryInside, isGlob, glob} from '@parcel/utils';

export type EntryResult = {|
  entries: Array<Entry>,
  files: Array<File>,
|};

export class EntryResolver {
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
