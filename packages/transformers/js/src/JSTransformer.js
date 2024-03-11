// @flow
import type {
  SourceLocation,
  FilePath,
  FileCreateInvalidation,
} from '@parcel/types';
import type {SchemaEntity} from '@parcel/utils';
import type {Diagnostic} from '@parcel/diagnostic';
import SourceMap from '@parcel/source-map';
import {Transformer} from '@parcel/plugin';
import {transform, transformAsync} from '@parcel/rust';
import path from 'path';
import semver from 'semver';
import ThrowableDiagnostic, {
  encodeJSONKeyComponent,
  convertSourceLocationToHighlight,
} from '@parcel/diagnostic';
import {validateSchema, remapSourceLocation} from '@parcel/utils';

const JSX_EXTENSIONS = {
  jsx: true,
  tsx: true,
};

const JSX_PRAGMA = {
  react: {
    pragma: 'React.createElement',
    pragmaFrag: 'React.Fragment',
    automatic: '>= 17.0.0 || ^16.14.0 || >= 0.0.0-0 < 0.0.0',
  },
  preact: {
    pragma: 'h',
    pragmaFrag: 'Fragment',
    automatic: '>= 10.5.0',
  },
  nervjs: {
    pragma: 'Nerv.createElement',
    pragmaFrag: undefined,
    automatic: undefined,
  },
  hyperapp: {
    pragma: 'h',
    pragmaFrag: undefined,
    automatic: undefined,
  },
};

const CONFIG_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    inlineFS: {
      type: 'boolean',
    },
    inlineEnvironment: {
      oneOf: [
        {
          type: 'boolean',
        },
        {
          type: 'array',
          items: {
            type: 'string',
          },
        },
      ],
    },
    unstable_inlineConstants: {
      type: 'boolean',
    },
  },
  additionalProperties: false,
};

type PackageJSONConfig = {|
  '@parcel/transformer-js'?: {|
    inlineFS?: boolean,
    inlineEnvironment?: boolean | Array<string>,
    unstable_inlineConstants?: boolean,
  |},
|};

const SCRIPT_ERRORS = {
  browser: {
    message: 'Browser scripts cannot have imports or exports.',
    hint: 'Add the type="module" attribute to the <script> tag.',
  },
  'web-worker': {
    message:
      'Web workers cannot have imports or exports without the `type: "module"` option.',
    hint: "Add {type: 'module'} as a second argument to the Worker constructor.",
  },
  'service-worker': {
    message:
      'Service workers cannot have imports or exports without the `type: "module"` option.',
    hint: "Add {type: 'module'} as a second argument to the navigator.serviceWorker.register() call.",
  },
};

type TSConfig = {
  compilerOptions?: {
    // https://www.typescriptlang.org/tsconfig#jsx
    jsx?: 'react' | 'react-jsx' | 'react-jsxdev' | 'preserve' | 'react-native',
    // https://www.typescriptlang.org/tsconfig#jsxFactory
    jsxFactory?: string,
    // https://www.typescriptlang.org/tsconfig#jsxFragmentFactory
    jsxFragmentFactory?: string,
    // https://www.typescriptlang.org/tsconfig#jsxImportSource
    jsxImportSource?: string,
    // https://www.typescriptlang.org/tsconfig#experimentalDecorators
    experimentalDecorators?: boolean,
    // https://www.typescriptlang.org/tsconfig#useDefineForClassFields
    useDefineForClassFields?: boolean,
    // https://www.typescriptlang.org/tsconfig#target
    target?: string, // 'es3' | 'es5' | 'es6' | 'es2015' | ...  |'es2022' | ... | 'esnext'
    ...
  },
  ...
};

type MacroAsset = {|
  type: string,
  content: string,
|};

// NOTE: Make sure this is in sync with the TypeScript definition in the @parcel/macros package.
type MacroContext = {|
  addAsset(asset: MacroAsset): void,
  invalidateOnFileChange(FilePath): void,
  invalidateOnFileCreate(FileCreateInvalidation): void,
  invalidateOnEnvChange(string): void,
  invalidateOnStartup(): void,
  invalidateOnBuild(): void,
|};

export default (new Transformer({
  async loadConfig({config, options}) {
    let pkg = await config.getPackage();
    let isJSX,
      pragma,
      pragmaFrag,
      jsxImportSource,
      automaticJSXRuntime,
      reactRefresh,
      decorators,
      useDefineForClassFields;
    if (config.isSource) {
      let reactLib;
      if (pkg?.alias && pkg.alias['react']) {
        // e.g.: `{ alias: { "react": "preact/compat" } }`
        reactLib = 'react';
      } else {
        // Find a dependency that we can map to a JSX pragma
        reactLib = Object.keys(JSX_PRAGMA).find(
          libName =>
            pkg?.dependencies?.[libName] ||
            pkg?.devDependencies?.[libName] ||
            pkg?.peerDependencies?.[libName],
        );
      }

      reactRefresh =
        options.hmrOptions &&
        options.mode === 'development' &&
        Boolean(
          pkg?.dependencies?.react ||
            pkg?.devDependencies?.react ||
            pkg?.peerDependencies?.react,
        );

      let tsconfig = await config.getConfigFrom<TSConfig>(
        options.projectRoot + '/index',
        ['tsconfig.json', 'jsconfig.json'],
      );
      let compilerOptions = tsconfig?.contents?.compilerOptions;

      // Use explicitly defined JSX options in tsconfig.json over inferred values from dependencies.
      pragma =
        compilerOptions?.jsxFactory ||
        (reactLib ? JSX_PRAGMA[reactLib].pragma : undefined);
      pragmaFrag =
        compilerOptions?.jsxFragmentFactory ||
        (reactLib ? JSX_PRAGMA[reactLib].pragmaFrag : undefined);

      if (
        compilerOptions?.jsx === 'react-jsx' ||
        compilerOptions?.jsx === 'react-jsxdev' ||
        compilerOptions?.jsxImportSource
      ) {
        jsxImportSource = compilerOptions?.jsxImportSource;
        automaticJSXRuntime = true;
      } else if (reactLib) {
        let effectiveReactLib =
          pkg?.alias && pkg.alias['react'] === 'preact/compat'
            ? 'preact'
            : reactLib;
        let automaticVersion = JSX_PRAGMA[effectiveReactLib]?.automatic;
        let reactLibVersion =
          pkg?.dependencies?.[effectiveReactLib] ||
          pkg?.devDependencies?.[effectiveReactLib] ||
          pkg?.peerDependencies?.[effectiveReactLib];
        reactLibVersion = reactLibVersion
          ? semver.validRange(reactLibVersion)
          : null;
        let minReactLibVersion =
          reactLibVersion !== null && reactLibVersion !== '*'
            ? semver.minVersion(reactLibVersion)?.toString()
            : null;

        automaticJSXRuntime =
          automaticVersion &&
          !compilerOptions?.jsxFactory &&
          minReactLibVersion != null &&
          semver.satisfies(minReactLibVersion, automaticVersion, {
            includePrerelease: true,
          });

        if (automaticJSXRuntime) {
          jsxImportSource = reactLib;
        }
      }

      isJSX = Boolean(compilerOptions?.jsx || pragma);
      decorators = compilerOptions?.experimentalDecorators;
      useDefineForClassFields = compilerOptions?.useDefineForClassFields;
      if (
        useDefineForClassFields === undefined &&
        compilerOptions?.target != null
      ) {
        // Default useDefineForClassFields to true if target is ES2022 or higher (including ESNext)
        let target = compilerOptions.target.slice(2);
        if (target === 'next') {
          useDefineForClassFields = true;
        } else {
          useDefineForClassFields = Number(target) >= 2022;
        }
      }
    }

    // Check if we should ignore fs calls
    // See https://github.com/defunctzombie/node-browser-resolve#skip
    let ignoreFS =
      pkg &&
      pkg.browser &&
      typeof pkg.browser === 'object' &&
      pkg.browser.fs === false;

    let result = await config.getConfigFrom<PackageJSONConfig>(
      path.join(options.projectRoot, 'index'),
      ['package.json'],
    );
    let rootPkg = result?.contents;

    let inlineEnvironment = config.isSource;
    let inlineFS = !ignoreFS;
    let inlineConstants = false;
    if (result && rootPkg?.['@parcel/transformer-js']) {
      validateSchema.diagnostic(
        CONFIG_SCHEMA,
        {
          data: rootPkg['@parcel/transformer-js'],
          // FIXME
          source: await options.inputFS.readFile(result.filePath, 'utf8'),
          filePath: result.filePath,
          prependKey: `/${encodeJSONKeyComponent('@parcel/transformer-js')}`,
        },
        // FIXME
        '@parcel/transformer-js',
        'Invalid config for @parcel/transformer-js',
      );

      inlineEnvironment =
        rootPkg['@parcel/transformer-js']?.inlineEnvironment ??
        inlineEnvironment;
      inlineFS = rootPkg['@parcel/transformer-js']?.inlineFS ?? inlineFS;
      inlineConstants =
        rootPkg['@parcel/transformer-js']?.unstable_inlineConstants ??
        inlineConstants;
    }

    return {
      isJSX,
      automaticJSXRuntime,
      jsxImportSource,
      pragma,
      pragmaFrag,
      inlineEnvironment,
      inlineFS,
      inlineConstants,
      reactRefresh,
      decorators,
      useDefineForClassFields,
    };
  },
  async transform({asset, config, options, logger}) {
    let [code, originalMap] = await Promise.all([
      asset.getBuffer(),
      asset.getMap(),
    ]);

    let supportsModuleWorkers =
      asset.env.shouldScopeHoist && asset.env.supports('worker-module', true);
    let isJSX = Boolean(config?.isJSX);
    if (asset.isSource) {
      if (asset.type === 'ts') {
        isJSX = false;
      } else if (!isJSX) {
        isJSX = Boolean(JSX_EXTENSIONS[asset.type]);
      }
    }

    let macroAssets = [];
    let {
      dependencies,
      code: compiledCode,
      map,
      shebang,
      diagnostics,
      used_env,
      invalidate_on_file_change,
    } = await (transformAsync || transform)(options.db, {
      code,
      map: await asset.getMapBuffer(),
      asset_id: asset.nativeAddress,
      inline_fs: Boolean(config?.inlineFS) && !asset.env.isNode(),
      inline_environment: config?.inlineEnvironment ?? true,
      is_jsx: isJSX,
      jsx_pragma: config?.pragma,
      jsx_pragma_frag: config?.pragmaFrag,
      automatic_jsx_runtime: Boolean(config?.automaticJSXRuntime),
      jsx_import_source: config?.jsxImportSource,
      react_refresh:
        asset.env.isBrowser() &&
        !asset.env.isLibrary &&
        !asset.env.isWorker() &&
        !asset.env.isWorklet() &&
        Boolean(config?.reactRefresh),
      decorators: Boolean(config?.decorators),
      use_define_for_class_fields: Boolean(config?.useDefineForClassFields),
      supports_module_workers: supportsModuleWorkers,
      inline_constants: config.inlineConstants,
      resolve_helpers_from: __filename,
      supports_dynamic_import: asset.env.supports('dynamic-import', true),
      callMacro: asset.isSource
        ? async (err, src, exportName, args, loc) => {
            let mod;
            try {
              mod = await options.packageManager.require(src, asset.filePath);

              // Default interop for CommonJS modules.
              if (
                exportName === 'default' &&
                !mod.__esModule &&
                // $FlowFixMe
                Object.prototype.toString.call(config) !== '[object Module]'
              ) {
                mod = {default: mod};
              }

              if (!Object.hasOwnProperty.call(mod, exportName)) {
                throw new Error(`"${src}" does not export "${exportName}".`);
              }
            } catch (err) {
              throw {
                kind: 1,
                message: err.message,
              };
            }

            try {
              if (typeof mod[exportName] === 'function') {
                let ctx: MacroContext = {
                  // Allows macros to emit additional assets to add as dependencies (e.g. css).
                  addAsset(a: MacroAsset) {
                    let k = String(macroAssets.length);
                    let map;
                    if (asset.env.sourceMap) {
                      // Generate a source map that maps each line of the asset to the original macro call.
                      map = new SourceMap(options.projectRoot);
                      let mappings = [];
                      let line = 1;
                      for (let i = 0; i <= a.content.length; i++) {
                        if (i === a.content.length || a.content[i] === '\n') {
                          mappings.push({
                            generated: {
                              line,
                              column: 0,
                            },
                            source: asset.filePath,
                            original: {
                              line: loc.line,
                              column: loc.col,
                            },
                          });
                          line++;
                        }
                      }

                      map.addIndexedMappings(mappings);
                      if (originalMap) {
                        map.extends(originalMap);
                      } else {
                        map.setSourceContent(asset.filePath, code.toString());
                      }
                    }

                    macroAssets.push({
                      type: a.type,
                      content: a.content,
                      map,
                      uniqueKey: k,
                    });

                    asset.addDependency({
                      specifier: k,
                      specifierType: 'esm',
                    });
                  },
                  invalidateOnFileChange(filePath) {
                    asset.invalidateOnFileChange(filePath);
                  },
                  invalidateOnFileCreate(invalidation) {
                    asset.invalidateOnFileCreate(invalidation);
                  },
                  invalidateOnEnvChange(env) {
                    asset.invalidateOnEnvChange(env);
                  },
                  invalidateOnStartup() {
                    asset.invalidateOnStartup();
                  },
                  invalidateOnBuild() {
                    asset.invalidateOnBuild();
                  },
                };

                return mod[exportName].apply(ctx, args);
              } else {
                throw new Error(
                  `"${exportName}" in "${src}" is not a function.`,
                );
              }
            } catch (err) {
              // Remove parcel core from stack and build string so Rust can process errors more easily.
              let stack = (err.stack || '').split('\n').slice(1);
              let message = err.message;
              for (let line of stack) {
                if (line.includes(__filename)) {
                  break;
                }
                message += '\n' + line;
              }
              throw {
                kind: 2,
                message,
              };
            }
          }
        : null,
    });

    let convertLoc = (loc): SourceLocation => {
      let location = {
        filePath: asset.filePath,
        start: {
          line: loc.start_line + Number(asset.meta.startLine ?? 1) - 1,
          column: loc.start_col,
        },
        end: {
          line: loc.end_line + Number(asset.meta.startLine ?? 1) - 1,
          column: loc.end_col,
        },
      };

      // If there is an original source map, use it to remap to the original source location.
      if (originalMap) {
        location = remapSourceLocation(location, originalMap);
      }

      return location;
    };

    if (diagnostics) {
      let errors = diagnostics.filter(
        d =>
          d.severity === 'Error' ||
          (d.severity === 'SourceError' && asset.isSource),
      );
      let warnings = diagnostics.filter(
        d =>
          d.severity === 'Warning' ||
          (d.severity === 'SourceError' && !asset.isSource),
      );
      let convertDiagnostic = diagnostic => {
        let message = diagnostic.message;
        if (message === 'SCRIPT_ERROR') {
          let err = SCRIPT_ERRORS[(asset.env.context: string)];
          message = err?.message || SCRIPT_ERRORS.browser.message;
        }

        let res: Diagnostic = {
          message,
          codeFrames: [
            {
              filePath: asset.filePath,
              codeHighlights: diagnostic.code_highlights?.map(highlight =>
                convertSourceLocationToHighlight(
                  convertLoc(highlight.loc),
                  highlight.message ?? undefined,
                ),
              ),
            },
          ],
          hints: diagnostic.hints,
        };

        if (diagnostic.documentation_url) {
          res.documentationURL = diagnostic.documentation_url;
        }

        if (diagnostic.show_environment) {
          if (asset.env.loc && asset.env.loc.filePath !== asset.filePath) {
            res.codeFrames?.push({
              filePath: asset.env.loc.filePath,
              codeHighlights: [
                convertSourceLocationToHighlight(
                  asset.env.loc,
                  'The environment was originally created here',
                ),
              ],
            });
          }

          let err = SCRIPT_ERRORS[(asset.env.context: string)];
          if (err && !message.startsWith('import() is not allowed in')) {
            // TODO: hack
            if (!res.hints) {
              res.hints = [err.hint];
            } else {
              res.hints.push(err.hint);
            }
          }
        }

        return res;
      };

      if (errors.length > 0) {
        throw new ThrowableDiagnostic({
          diagnostic: errors.map(convertDiagnostic),
        });
      }

      logger.warn(warnings.map(convertDiagnostic));
    }

    if (shebang) {
      asset.meta.interpreter = shebang;
    }

    for (let env of used_env) {
      asset.invalidateOnEnvChange(env);
    }

    for (let file of invalidate_on_file_change) {
      asset.invalidateOnFileChange(file);
    }

    asset.setNativeDependencies(dependencies);

    asset.meta.id = asset.id;
    asset.type = 'js';
    asset.setBuffer(compiledCode);

    if (map) {
      let sourceMap = new SourceMap(options.projectRoot);
      sourceMap.addVLQMap(JSON.parse(map));
      if (originalMap) {
        sourceMap.extends(originalMap);
      }
      asset.setMap(sourceMap);
    }

    return [asset, ...macroAssets];
  },
}): Transformer);
