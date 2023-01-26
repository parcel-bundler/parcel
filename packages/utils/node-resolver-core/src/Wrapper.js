// @flow
import {Resolver} from '../index';
import builtins, {empty} from './builtins';

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
  options: any;

  constructor(projectRoot: string, options: any) {
    this.projectRoot = projectRoot;
    this.options = options;
    this.resolversByEnv = new Map();
  }

  resolve(options: ResolveOptions) {
    let resolver = this.resolversByEnv.get(options.env.id);
    if (!resolver) {
      resolver = new Resolver(this.projectRoot, {
        ...this.options,
        includeNodeModules: options.env.includeNodeModules
      });
      this.resolversByEnv.set(options.env.id, resolver);
    }
    let res = resolver.resolve(options);

    if (res.builtin) {
      return this.resolveBuiltin(res.builtin, options);
    }

    return res;
  }

  async resolveBuiltin(name: string, options: ResolveOptions) {
    if (options.env.isNode()) {
      return {isExcluded: true};
    }

    if (options.env.isElectron() && name === 'electron') {
      return {isExcluded: true};
    }

    // By default, exclude node builtins from libraries unless explicitly opted in.
    // if (
    //   env.isLibrary &&
    //   this.shouldIncludeNodeModule(env, filename) !== true
    // ) {
    //   return null;
    // }

    let builtin = builtins[name];
    if (!builtin || builtin.name === empty) {
      return {
        filePath: empty
      };
    }

    let resolved = this.resolve({
      ...options,
      filename: builtin.name,
    });

    // Autoinstall/verify version of builtin polyfills
    if (builtin.range != null) {
      // This assumes that there are no polyfill packages that are scoped
      // Append '/' to force this.packageManager to look up the package in node_modules
      let packageName = builtin.name.split('/')[0] + '/';
      let packageManager = this.packageManager;
      if (resolved == null) {
        // Auto install the Node builtin polyfills
        if (this.shouldAutoInstall && packageManager) {
          this.logger?.warn({
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
              this.projectRoot + '/index',
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
            this.projectRoot + '/index',
            {
              saveDev: true,
              shouldAutoInstall: this.shouldAutoInstall,
              range: builtin.range,
            },
          );
        } catch (e) {
          this.logger?.warn(errorToDiagnostic(e));
        }
      }
    }

    return resolved;
  }
}
