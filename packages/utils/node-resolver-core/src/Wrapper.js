// @flow
import type {FilePath, SpecifierType, SemverRange, Environment, SourceLocation} from '@parcel/types';
import type {Diagnostic} from '@parcel/diagnostic';
import {Resolver} from '../index';
import builtins, {empty} from './builtins';
import path from 'path';
import {
  isGlob,
  relativePath,
  normalizeSeparators,
  findAlternativeNodeModules,
  findAlternativeFiles,
  loadConfig,
  getModuleParts,
  globToRegex,
  isGlobMatch,
} from '@parcel/utils';
import ThrowableDiagnostic, {
  encodeJSONKeyComponent,
  errorToDiagnostic,
  generateJSONCodeHighlights,
  md,
} from '@parcel/diagnostic';
import semver from 'semver';

type Options = {|
  fs: FileSystem,
  projectRoot: FilePath,
  extensions: Array<string>,
  mainFields: Array<string>,
  packageManager?: PackageManager,
  logger?: PluginLogger,
  shouldAutoInstall?: boolean,
|};

type ResolveOptions = {|
  filename: FilePath,
  parent: ?FilePath,
  specifierType: SpecifierType,
  range?: ?SemverRange,
  env: Environment,
  sourcePath?: ?FilePath,
  loc?: ?SourceLocation,
|};

export default class NodeResolver {
  resolversByEnv: Map<string, any>;
  projectRoot: FilePath;
  options: Options;

  constructor(options: Options) {
    this.options = options;
    this.resolversByEnv = new Map();
  }

  async resolve(options: ResolveOptions) {
    let res = this.resolveBase(options);

    if (res.error) {
      let diagnostic = await this.handleError(res.error, options);
      return {
        diagnostics: [diagnostic],
        invalidateOnFileCreate: res.invalidateOnFileCreate,
        invalidateOnFileChange: res.invalidateOnFileChange
      };
    }

    if (res.builtin) {
      return this.resolveBuiltin(res.builtin, options);
    }

    if (res.filePath == null) {
      if (options.sourcePath && options.env.isLibrary && options.specifierType !== 'url') {
        let diagnostic = await this.checkExcludedDependency(options.sourcePath, options.filename, options);
        if (diagnostic) {
          return {
            diagnostics: [diagnostic],
            invalidateOnFileCreate: res.invalidateOnFileCreate,
            invalidateOnFileChange: res.invalidateOnFileChange
          };
        }
      }

      // TODO: invalidations?
      return {isExcluded: true}
    }

    return res;
  }

  resolveBase(options: ResolveOptions) {
    let resolver = this.resolversByEnv.get(options.env.id);
    if (!resolver) {
      resolver = new Resolver(this.options.projectRoot, {
        fs: {
          canonicalize: path => this.options.fs.realpathSync(path),
          read: path => this.options.fs.readFileSync(path),
          isFile: path => this.options.fs.statSync(path).isFile(),
          isDir: path => this.options.fs.statSync(path).isDirectory()
        },
        includeNodeModules: options.env.includeNodeModules,
        isBrowser: options.env.isBrowser()
      });
      this.resolversByEnv.set(options.env.id, resolver);
    }
    return resolver.resolve(options);
  }

  async resolveBuiltin(name: string, options: ResolveOptions) {
    if (options.env.isNode()) {
      return {isExcluded: true};
    }

    if (options.env.isElectron() && name === 'electron') {
      return {isExcluded: true};
    }

    // By default, exclude node builtins from libraries unless explicitly opted in.
    if (
      options.env.isLibrary &&
      this.shouldIncludeNodeModule(options.env, name) !== true
    ) {
      return {isExcluded: true};
    }

    let builtin = builtins[name];
    if (!builtin || builtin.name === empty) {
      return {
        filePath: empty
      };
    }

    let resolved = this.resolveBase({
      ...options,
      filename: builtin.name,
    });

    // Autoinstall/verify version of builtin polyfills
    if (builtin.range != null) {
      // This assumes that there are no polyfill packages that are scoped
      // Append '/' to force this.packageManager to look up the package in node_modules
      let packageName = builtin.name.split('/')[0] + '/';
      let packageManager = this.options.packageManager;
      if (resolved == null) {
        // Auto install the Node builtin polyfills
        if (this.options.shouldAutoInstall && packageManager) {
          this.options.logger?.warn({
            message: md`Auto installing polyfill for Node builtin module "${specifier}"...`,
            codeFrames: [
              {
                filePath: ctx.loc?.filePath ?? sourceFile,
                codeHighlights: ctx.loc
                  ? [
                      {
                        message: 'used here',
                        start: ctx.loc.start,
                        end: ctx.loc.end,
                      },
                    ]
                  : [],
              },
            ],
            documentationURL:
              'https://parceljs.org/features/node-emulation/#polyfilling-%26-excluding-builtin-node-modules',
          });

          await packageManager.resolve(
            packageName,
            this.projectRoot + '/index',
            {
              saveDev: true,
              shouldAutoInstall: true,
              range: builtin.range,
            },
          );

          // Re-resolve
          try {
            resolved = this.findNodeModulePath(
              filename,
              this.options.projectRoot + '/index',
              ctx,
            );
          } catch (err) {
            // ignore
          }
        } else {
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: md`Node builtin polyfill "${packageName}" is not installed, but auto install is disabled.`,
              codeFrames: [
                {
                  filePath: ctx.loc?.filePath ?? sourceFile,
                  codeHighlights: ctx.loc
                    ? [
                        {
                          message: 'used here',
                          start: ctx.loc.start,
                          end: ctx.loc.end,
                        },
                      ]
                    : [],
                },
              ],
              documentationURL:
                'https://parceljs.org/features/node-emulation/#polyfilling-%26-excluding-builtin-node-modules',
              hints: [
                md`Install the "${packageName}" package with your package manager, and run Parcel again.`,
              ],
            },
          });
        }
      } else if (builtin.range != null) {
        // Assert correct version
        try {
          // TODO packageManager can be null for backwards compatibility, but that could cause invalid
          // resolutions in monorepos
          await packageManager?.resolve(
            packageName,
            this.options.projectRoot + '/index',
            {
              saveDev: true,
              shouldAutoInstall: this.options.shouldAutoInstall,
              range: builtin.range,
            },
          );
        } catch (e) {
          this.options.logger?.warn(errorToDiagnostic(e));
        }
      }
    }

    return resolved;
  }

  shouldIncludeNodeModule(
    {includeNodeModules}: Environment,
    name: string,
  ): ?boolean {
    if (includeNodeModules === false) {
      return false;
    }

    if (Array.isArray(includeNodeModules)) {
      let [moduleName] = getModuleParts(name);
      return includeNodeModules.includes(moduleName);
    }

    if (includeNodeModules && typeof includeNodeModules === 'object') {
      let [moduleName] = getModuleParts(name);
      let include = includeNodeModules[moduleName];
      if (include != null) {
        return !!include;
      }
    }
  }

  async handleError(error, options: ResolveOptions) {
    // console.log(error)
    switch (error.type) {
      case 'FileNotFound': {
        let dir = path.dirname(error.from);
        let relative = error.relative;
        if (!relative.startsWith('.')) {
          relative = './' + relative;
        }

        let potentialFiles = await findAlternativeFiles(
          this.options.fs,
          relative,
          dir,
          this.options.projectRoot,
          true,
          options.specifierType !== 'url',
          // extensions.length === 0,
        );

        return {
          message: md`Cannot load file '${relative}' in '${relativePath(
            this.options.projectRoot,
            dir,
          )}'.`,
          hints: potentialFiles.map(r => {
            return `Did you mean '__${r}__'?`;
          }),
        };
      }
      case 'ModuleNotFound': {
        let alternativeModules = await findAlternativeNodeModules(
          this.options.fs,
          error.module,
          options.parent ? path.dirname(options.parent) : this.options.projectRoot,
        );
  
        return {
          message: md`Cannot find module '${error.module}'`,
          hints: alternativeModules.map(r => {
            return `Did you mean '__${r}__'?`;
          }),
        };
      }
      case 'ModuleEntryNotFound': {
        let dir = path.dirname(error.package_path);
        let fileSpecifier = relativePath(dir, error.entry_path);
        let alternatives = await findAlternativeFiles(
          this.options.fs,
          fileSpecifier,
          dir,
          this.options.projectRoot,
        );

        let alternative = alternatives[0];
        let pkgContent = await this.options.fs.readFile(error.package_path, 'utf8');
        return {
          message: md`Could not load '${fileSpecifier}' from module '${error.module}' found in package.json#${error.field}`,
          codeFrames: [
            {
              filePath: error.package_path,
              language: 'json',
              code: pkgContent,
              codeHighlights: generateJSONCodeHighlights(pkgContent, [
                {
                  key: `/${error.field}`,
                  type: 'value',
                  message: md`'${fileSpecifier}' does not exist${
                    alternative ? `, did you mean '${alternative}'?` : ''
                  }'`,
                },
              ]),
            },
          ],
        };
      }
      case 'ModuleSubpathNotFound': {
        let dir = path.dirname(error.package_path);
        let relative = relativePath(dir, error.path, false);
        let potentialFiles = await findAlternativeFiles(
          this.options.fs,
          relative,
          dir,
          this.options.projectRoot,
          false
        );

        return {
          message: md`Cannot load file './${relative}' from module '${error.module}'`,
          hints: potentialFiles.map(r => {
            return `Did you mean '__${error.module}/${r}__'?`;
          }),
        };
      }
      case 'JsonError': {
        let pkgContent = await this.options.fs.readFile(error.path, 'utf8');
        return {
          message: md`Error parsing JSON`,
          codeFrames: [
            {
              filePath: error.path,
              language: 'json',
              code: pkgContent,
              codeHighlights: [
                {
                  message: error.message,
                  start: {
                    line: error.line,
                    column: error.column
                  },
                  end: {
                    line: error.line,
                    column: error.column
                  }
                }
              ]
            },
          ],
        };
      }
    }
  }

  async checkExcludedDependency(
    sourceFile: FilePath,
    name: string,
    options: ResolveOptions,
  ): Promise<?Diagnostic> {
    let [moduleName] = getModuleParts(name);
    let res = await loadConfig(
      this.options.fs,
      sourceFile,
      ['package.json'],
      this.projectRoot,
      // By default, loadConfig uses JSON5. Use normal JSON for package.json files
      // since they don't support comments and JSON.parse is faster.
      {parser: (...args) => JSON.parse(...args)},
    );
    if (!res) {
      return;
    }
    
    let pkg = res.config;
    let pkgfile = res.files[0].filePath;
    if (
      !pkg.dependencies?.[moduleName] &&
      !pkg.peerDependencies?.[moduleName] &&
      !pkg.engines?.[moduleName]
    ) {
      let pkgContent = await this.options.fs.readFile(pkgfile, 'utf8');
      return {
        message: md`External dependency "${moduleName}" is not declared in package.json.`,
        codeFrames: [
          {
            filePath: pkgfile,
            language: 'json',
            code: pkgContent,
            codeHighlights: pkg.dependencies
              ? generateJSONCodeHighlights(pkgContent, [
                  {
                    key: `/dependencies`,
                    type: 'key',
                  },
                ])
              : [
                  {
                    start: {
                      line: 1,
                      column: 1,
                    },
                    end: {
                      line: 1,
                      column: 1,
                    },
                  },
                ],
          },
        ],
        hints: [`Add "${moduleName}" as a dependency.`],
      };
    }

    if (options.range) {
      let range = options.range;
      let depRange =
        pkg.dependencies?.[moduleName] || pkg.peerDependencies?.[moduleName];
      if (depRange && !semver.intersects(depRange, range)) {
        let pkgContent = await this.options.fs.readFile(pkgfile, 'utf8');
        let field = pkg.dependencies?.[moduleName]
          ? 'dependencies'
          : 'peerDependencies';
        return {
          message: md`External dependency "${moduleName}" does not satisfy required semver range "${range}".`,
          codeFrames: [
            {
              filePath: pkgfile,
              language: 'json',
              code: pkgContent,
              codeHighlights: generateJSONCodeHighlights(pkgContent, [
                {
                  key: `/${field}/${encodeJSONKeyComponent(moduleName)}`,
                  type: 'value',
                  message: 'Found this conflicting requirement.',
                },
              ]),
            },
          ],
          hints: [
            `Update the dependency on "${moduleName}" to satisfy "${range}".`,
          ],
        };
      }
    }
  }
}
