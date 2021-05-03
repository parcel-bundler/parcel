// @flow strict-local

import type {Async, FilePath, File, PackageJSON} from '@parcel/types';
import type {StaticRunOpts} from '../RequestTracker';
import type {Entry, ParcelOptions} from '../types';
import type {FileSystem} from '@parcel/fs';

import {isDirectoryInside, isGlob, glob} from '@parcel/utils';
import ThrowableDiagnostic, {md} from '@parcel/diagnostic';
import path from 'path';

type RunOpts = {|
  input: FilePath,
  ...StaticRunOpts,
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
    api.invalidateOnFileCreate({glob: input});
  }

  // Invalidate whenever an entry is deleted.
  // If the entry was a glob, we'll re-evaluate it, and otherwise
  // a proper entry error will be thrown.
  for (let entry of result.entries) {
    api.invalidateOnFileDelete(entry.filePath);
  }

  return result;
}

async function assertFile(
  fs: FileSystem,
  source: string,
  diagnosticPath: string,
) {
  let stat;
  try {
    stat = await fs.stat(source);
  } catch (err) {
    throw new ThrowableDiagnostic({
      diagnostic: {
        message: `${diagnosticPath} does not exist`,
        filePath: source,
      },
    });
  }

  if (!stat.isFile()) {
    throw new ThrowableDiagnostic({
      diagnostic: {
        message: `${diagnosticPath} is not a file`,
        filePath: source,
      },
    });
  }
}

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
      throw new ThrowableDiagnostic({
        diagnostic: {
          message: md`Entry ${entry} does not exist`,
          filePath: entry,
        },
      });
    }

    if (stat.isDirectory()) {
      let pkg = await this.readPackage(entry);

      if (pkg) {
        let {filePath} = pkg;
        let entries = [];
        let files = [{filePath}];

        let targetsWithSources = 0;
        if (pkg.targets) {
          for (let targetName in pkg.targets) {
            let target = pkg.targets[targetName];
            if (target.source != null) {
              targetsWithSources++;
              let targetSources = Array.isArray(target.source)
                ? target.source
                : [target.source];
              for (let relativeSource of targetSources) {
                let source = path.join(entry, relativeSource);
                let diagnosticPath = md`${relativeSource} in ${path.relative(
                  this.options.inputFS.cwd(),
                  filePath,
                )}#targets["${targetName}"].source`;
                await assertFile(this.options.inputFS, source, diagnosticPath);

                entries.push({
                  filePath: source,
                  packagePath: entry,
                  target: targetName,
                });
              }
            }
          }
        }

        let allTargetsHaveSource =
          targetsWithSources > 0 &&
          pkg != null &&
          pkg.targets != null &&
          Object.keys(pkg.targets).length === targetsWithSources;

        if (!allTargetsHaveSource && pkg.source != null) {
          let pkgSources = Array.isArray(pkg.source)
            ? pkg.source
            : [pkg.source];
          for (let pkgSource of pkgSources) {
            let source = path.join(path.dirname(filePath), pkgSource);
            let diagnosticPath = md`${pkgSource} in ${path.relative(
              this.options.inputFS.cwd(),
              filePath,
            )}#source`;
            await assertFile(this.options.inputFS, source, diagnosticPath);
            entries.push({filePath: source, packagePath: entry});
          }
        }

        // Only return if we found any valid entries
        if (entries.length && files.length) {
          return {
            entries,
            files,
          };
        }
      }

      throw new ThrowableDiagnostic({
        diagnostic: {
          message: md`Could not find entry: ${entry}`,
          filePath: entry,
        },
      });
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

    throw new ThrowableDiagnostic({
      diagnostic: {
        message: `Unknown entry: ${entry}`,
        filePath: entry,
      },
    });
  }

  async readPackage(
    entry: FilePath,
  ): Promise<?{...PackageJSON, filePath: FilePath, ...}> {
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
      throw new ThrowableDiagnostic({
        diagnostic: {
          message: md`Error parsing ${path.relative(
            this.options.inputFS.cwd(),
            pkgFile,
          )}: ${err.message}`,
          filePath: pkgFile,
        },
      });
    }

    return {...pkg, filePath: pkgFile};
  }
}
