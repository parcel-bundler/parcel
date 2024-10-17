// @flow strict-local

import type {Async, FilePath, PackageJSON, Glob} from '@parcel/types';
import type {StaticRunOpts} from '../RequestTracker';
import type {Entry, InternalFile, ParcelOptions} from '../types';
import type {FileSystem} from '@parcel/fs';

import {
  isDirectoryInside,
  isGlob,
  glob,
  findAlternativeFiles,
} from '@parcel/utils';
import ThrowableDiagnostic, {
  encodeJSONKeyComponent,
  md,
  generateJSONCodeHighlights,
  getJSONSourceLocation,
} from '@parcel/diagnostic';
import path from 'path';
import {parse, type Mapping} from '@mischnic/json-sourcemap';
import {requestTypes} from '../RequestTracker';
import {
  type ProjectPath,
  fromProjectPath,
  fromProjectPathRelative,
  toProjectPath,
} from '../projectPath';

type RunOpts<TResult> = {|
  input: ProjectPath,
  ...StaticRunOpts<TResult>,
|};

export type EntryRequest = {|
  id: string,
  +type: typeof requestTypes.entry_request,
  run: (RunOpts<EntryRequestResult>) => Async<EntryRequestResult>,
  input: ProjectPath,
|};

export type EntryRequestResult = {|
  entries: Array<Entry>,
  files: Array<InternalFile>,
  globs: Array<Glob>,
|};

const type = 'entry_request';

export default function createEntryRequest(input: ProjectPath): EntryRequest {
  return {
    id: `${type}:${fromProjectPathRelative(input)}`,
    type: requestTypes.entry_request,
    run,
    input,
  };
}

async function run({input, api, options}): Promise<EntryRequestResult> {
  let entryResolver = new EntryResolver(options);
  let filePath = fromProjectPath(options.projectRoot, input);
  let result = await entryResolver.resolveEntry(filePath);

  // Connect files like package.json that affect the entry
  // resolution so we invalidate when they change.
  for (let file of result.files) {
    api.invalidateOnFileUpdate(file.filePath);
    api.invalidateOnFileDelete(file.filePath);
  }

  // If the entry specifier is a glob, add a glob node so
  // we invalidate when a new file matches.
  for (let glob of result.globs) {
    api.invalidateOnFileCreate({
      glob: toProjectPath(options.projectRoot, glob),
    });
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
  entry: FilePath,
  relativeSource: FilePath,
  pkgFilePath: FilePath,
  keyPath: string,
  options: ParcelOptions,
) {
  let source = path.join(entry, relativeSource);
  let stat;
  try {
    stat = await fs.stat(source);
  } catch (err) {
    let contents = await fs.readFile(pkgFilePath, 'utf8');
    let alternatives = await findAlternativeFiles(
      fs,
      relativeSource,
      entry,
      options.projectRoot,
      false,
    );
    throw new ThrowableDiagnostic({
      diagnostic: {
        origin: '@parcel/core',
        message: md`${path.relative(process.cwd(), source)} does not exist.`,
        codeFrames: [
          {
            filePath: pkgFilePath,
            codeHighlights: generateJSONCodeHighlights(contents, [
              {
                key: keyPath,
                type: 'value',
              },
            ]),
          },
        ],
        hints: alternatives.map(r => {
          return md`Did you mean '__${r}__'?`;
        }),
      },
    });
  }

  if (!stat.isFile()) {
    let contents = await fs.readFile(pkgFilePath, 'utf8');
    throw new ThrowableDiagnostic({
      diagnostic: {
        origin: '@parcel/core',
        message: md`${path.relative(process.cwd(), source)} is not a file.`,
        codeFrames: [
          {
            filePath: pkgFilePath,
            codeHighlights: generateJSONCodeHighlights(contents, [
              {
                key: keyPath,
                type: 'value',
              },
            ]),
          },
        ],
      },
    });
  }
}

export class EntryResolver {
  options: ParcelOptions;

  constructor(options: ParcelOptions) {
    this.options = options;
  }

  async resolveEntry(entry: FilePath): Promise<EntryRequestResult> {
    let stat;
    try {
      stat = await this.options.inputFS.stat(entry);
    } catch (err) {
      if (!isGlob(entry)) {
        throw new ThrowableDiagnostic({
          diagnostic: {
            message: md`Entry ${entry} does not exist`,
          },
        });
      }
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
          globs: p.globs.concat(res.globs),
        }),
        {entries: [], files: [], globs: [entry]},
      );
    }

    if (stat.isDirectory()) {
      let pkg = await this.readPackage(entry);

      if (pkg) {
        let {filePath} = pkg;
        let entries = [];
        let files = [
          {
            filePath: toProjectPath(this.options.projectRoot, filePath),
          },
        ];
        let globs = [];

        let targetsWithSources = 0;
        if (pkg.targets) {
          for (let targetName in pkg.targets) {
            let target = pkg.targets[targetName];
            if (target.source != null) {
              targetsWithSources++;
              let targetSources = Array.isArray(target.source)
                ? target.source
                : [target.source];
              let i = 0;
              for (let source of targetSources) {
                let sources;
                if (isGlob(source)) {
                  globs.push(source);
                  sources = await glob(source, this.options.inputFS, {
                    onlyFiles: true,
                    cwd: entry,
                  });
                } else {
                  sources = [source];
                }
                let keyPath = `/targets/${encodeJSONKeyComponent(
                  targetName,
                )}/source${Array.isArray(target.source) ? `/${i}` : ''}`;
                for (let relativeSource of sources) {
                  let source = path.join(entry, relativeSource);
                  await assertFile(
                    this.options.inputFS,
                    entry,
                    relativeSource,
                    filePath,
                    keyPath,
                    this.options,
                  );

                  entries.push({
                    filePath: toProjectPath(this.options.projectRoot, source),
                    packagePath: toProjectPath(this.options.projectRoot, entry),
                    target: targetName,
                    loc: {
                      filePath: toProjectPath(
                        this.options.projectRoot,
                        pkg.filePath,
                      ),
                      ...getJSONSourceLocation(
                        pkg.map.pointers[keyPath],
                        'value',
                      ),
                    },
                  });
                }
                i++;
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
          let i = 0;
          for (let pkgSource of pkgSources) {
            let sources;
            if (isGlob(pkgSource)) {
              globs.push(pkgSource);
              sources = await glob(pkgSource, this.options.inputFS, {
                onlyFiles: true,
                cwd: path.dirname(filePath),
              });
            } else {
              sources = [pkgSource];
            }
            let keyPath = `/source${Array.isArray(pkg.source) ? `/${i}` : ''}`;
            for (let relativeSource of sources) {
              let source = path.join(path.dirname(filePath), relativeSource);
              await assertFile(
                this.options.inputFS,
                entry,
                relativeSource,
                filePath,
                keyPath,
                this.options,
              );
              entries.push({
                filePath: toProjectPath(this.options.projectRoot, source),
                packagePath: toProjectPath(this.options.projectRoot, entry),
                loc: {
                  filePath: toProjectPath(
                    this.options.projectRoot,
                    pkg.filePath,
                  ),
                  ...getJSONSourceLocation(pkg.map.pointers[keyPath], 'value'),
                },
              });
            }
            i++;
          }
        }

        // Only return if we found any valid entries
        if (entries.length && files.length) {
          return {
            entries,
            files,
            globs,
          };
        }
      }

      throw new ThrowableDiagnostic({
        diagnostic: {
          message: md`Could not find entry: ${entry}`,
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
        entries: [
          {
            filePath: toProjectPath(this.options.projectRoot, entry),
            packagePath: toProjectPath(this.options.projectRoot, packagePath),
          },
        ],
        files: [],
        globs: [],
      };
    }

    throw new ThrowableDiagnostic({
      diagnostic: {
        message: md`Unknown entry: ${entry}`,
      },
    });
  }

  async readPackage(entry: FilePath): Promise<?{
    ...PackageJSON,
    filePath: FilePath,
    map: {|data: mixed, pointers: {|[string]: Mapping|}|},
    ...
  }> {
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
      // TODO: code frame?
      throw new ThrowableDiagnostic({
        diagnostic: {
          message: md`Error parsing ${path.relative(
            this.options.inputFS.cwd(),
            pkgFile,
          )}: ${err.message}`,
        },
      });
    }

    return {
      ...pkg,
      filePath: pkgFile,
      map: parse(content, undefined, {tabWidth: 1}),
    };
  }
}
