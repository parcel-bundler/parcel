// @flow
import type {
  EnvMap,
  SourceLocation,
  FilePath,
  FileCreateInvalidation,
} from '@parcel/types';
import type {SchemaEntity} from '@parcel/utils';
import type {Diagnostic} from '@parcel/diagnostic';
import SourceMap from '@parcel/source-map';
import {Transformer} from '@parcel/plugin';
import {transform, transformAsync, dependencyFromRust, envToRust} from '@parcel/rust';
import semver from 'semver';
import nullthrows from 'nullthrows';
import ThrowableDiagnostic, {
  encodeJSONKeyComponent,
} from '@parcel/diagnostic';
import {validateSchema, remapSourceLocation, globMatch} from '@parcel/utils';
import pkg from '../package.json';

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
        let reactLibVersion =
          pkg?.dependencies?.[effectiveReactLib] ||
          pkg?.devDependencies?.[effectiveReactLib] ||
          pkg?.peerDependencies?.[effectiveReactLib];
        if (effectiveReactLib === 'react' && reactLibVersion === 'canary') {
          automaticJSXRuntime = true;
        } else {
          let automaticVersion = JSX_PRAGMA[effectiveReactLib]?.automatic;
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
        }

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

    let conf = await config.getConfigFrom(options.projectRoot + '/index', [], {
      packageKey: '@parcel/transformer-js',
    });

    let inlineEnvironment = config.isSource;
    let inlineFS = !ignoreFS;
    let inlineConstants = false;
    if (conf && conf.contents) {
      validateSchema.diagnostic(
        CONFIG_SCHEMA,
        {
          data: conf.contents,
          // FIXME
          source: await options.inputFS.readFile(conf.filePath, 'utf8'),
          filePath: conf.filePath,
          prependKey: `/${encodeJSONKeyComponent('@parcel/transformer-js')}`,
        },
        // FIXME
        '@parcel/transformer-js',
        'Invalid config for @parcel/transformer-js',
      );

      inlineEnvironment = conf.contents?.inlineEnvironment ?? inlineEnvironment;
      inlineFS = conf.contents?.inlineFS ?? inlineFS;
      inlineConstants =
        conf.contents?.unstable_inlineConstants ?? inlineConstants;
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

    let env: EnvMap = {};

    if (!config?.inlineEnvironment) {
      if (options.env.NODE_ENV != null) {
        env.NODE_ENV = options.env.NODE_ENV;
      }

      if (process.env.PARCEL_BUILD_ENV === 'test') {
        env.PARCEL_BUILD_ENV = 'test';
      }
    } else if (Array.isArray(config?.inlineEnvironment)) {
      for (let match of globMatch(
        Object.keys(options.env),
        config.inlineEnvironment,
      )) {
        env[match] = String(options.env[match]);
      }
    } else {
      for (let key in options.env) {
        if (!key.startsWith('npm_')) {
          env[key] = String(options.env[key]);
        }
      }
    }

    let isJSX = Boolean(config?.isJSX);
    if (asset.type === 'ts') {
      isJSX = false;
    } else if (!isJSX) {
      isJSX = Boolean(JSX_EXTENSIONS[asset.type]);
    }

    let type = 'js';
    if (asset.type === 'ts' || asset.type === 'tsx' || asset.type === 'mdx') {
      type = asset.type;
    } else if (isJSX) {
      type = 'jsx';
    }

    let macroAssets = [];
    let {
      dependencies,
      code: compiledCode,
      map,
      shebang,
      hoist_result,
      symbol_result,
      needs_esm_helpers,
      diagnostics,
      used_env,
      has_node_replacements,
      is_constant_module,
      directives,
      helpers,
      mdx_exports,
      mdx_toc,
      mdx_assets,
    } = await (transformAsync || transform)({
      filename: asset.filePath,
      code,
      module_id: asset.id,
      project_root: options.projectRoot,
      inline_fs: Boolean(config?.inlineFS),
      env,
      environment: envToRust(asset.env),
      type,
      jsx_pragma: config?.pragma,
      jsx_pragma_frag: config?.pragmaFrag,
      automatic_jsx_runtime: Boolean(config?.automaticJSXRuntime),
      jsx_import_source: config?.jsxImportSource,
      is_development: options.mode === 'development',
      react_refresh: Boolean(config?.reactRefresh),
      decorators: Boolean(config?.decorators),
      use_define_for_class_fields: Boolean(config?.useDefineForClassFields),
      source_maps: !!asset.env.sourceMap,
      trace_bailouts: options.logLevel === 'verbose',
      is_swc_helpers: /@swc[/\\]helpers/.test(asset.filePath),
      standalone: asset.query.has('standalone'),
      inline_constants: config.inlineConstants,
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
                      bundleBehavior: null,
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

    if (is_constant_module) {
      asset.meta.isConstantModule = true;
    }

    let startLine = asset.meta?.startLine;
    let convertLoc = (loc: SourceLocation): SourceLocation => {
      if (typeof startLine === 'number') {
        loc = {
          filePath: loc.filePath,
          start: {
            line: loc.start.line + (startLine ?? 1) - 1,
            column: loc.start.column
          },
          end: {
            line: loc.end.line + (startLine ?? 1) - 1,
            column: loc.end.column
          }
        };
      }

      // If there is an original source map, use it to remap to the original source location.
      if (originalMap) {
        return remapSourceLocation(loc, originalMap);
      }

      return loc;
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

      let mapDiagnostic = (diagnostic: Diagnostic) => {
        if ((originalMap || startLine) && diagnostic.codeFrames) {
          for (let frame of diagnostic.codeFrames) {
            for (let highlight of frame.codeHighlights) {
              let location = convertLoc({
                filePath: frame.filePath || '',
                start: highlight.start,
                end: {
                  line: highlight.end.line,
                  column: highlight.end.column + 1
                }
              });
              highlight.start = location.start;
              highlight.end = {
                line: location.end.line,
                column: location.end.column - 1
              };
            }
          }
        }
        return diagnostic;
      };

      if (errors.length > 0) {
        throw new ThrowableDiagnostic({
          diagnostic: errors.map(mapDiagnostic),
        });
      }

      logger.warn(warnings.map(mapDiagnostic));
    }

    if (shebang) {
      asset.meta.interpreter = shebang;
    }

    if (has_node_replacements) {
      asset.meta.has_node_replacements = has_node_replacements;
    }

    if (asset.type === 'mdx') {
      asset.meta.ssgMeta = {
        exports: mdx_exports,
        tableOfContents: mdx_toc,
      };

      for (let [i, mdxAsset] of mdx_assets.entries()) {
        let map;
        if (asset.env.sourceMap && mdxAsset.position) {
          // Generate a source map that maps each line of the asset to the original code block.
          map = new SourceMap(options.projectRoot);
          let mappings = [];
          let line = 1;
          let column = mdxAsset.position.start.column;
          for (
            let i = mdxAsset.position.start.line + 1;
            i < mdxAsset.position.end.line;
            i++
          ) {
            mappings.push({
              generated: {
                line,
                column: 0,
              },
              source: asset.filePath,
              original: {
                line: i,
                column,
              },
            });
            line++;
            column = 0;
          }

          map.addIndexedMappings(mappings);
          if (originalMap) {
            map.extends(originalMap);
          } else {
            map.setSourceContent(asset.filePath, code.toString());
          }
        }

        macroAssets.push({
          type: mdxAsset.lang,
          content: mdxAsset.code,
          map,
          uniqueKey: 'mdx-' + i,
          bundleBehavior: null,
        });
      }
    }

    for (let env of used_env) {
      asset.invalidateOnEnvChange(env);
    }

    asset.meta.id = asset.id;
    asset.meta.directives = directives;
    asset.meta.usedHelpers = helpers;
    if (
      asset.env.isServer() &&
      !asset.env.isLibrary &&
      (directives.includes('use client') ||
        directives.includes('use client-entry'))
    ) {
      asset.setEnvironment({
        context: 'react-client',
        sourceType: 'module',
        outputFormat: 'esmodule',
        engines: asset.env.engines,
        includeNodeModules: true,
        isLibrary: false,
        sourceMap: asset.env.sourceMap,
        shouldOptimize: asset.env.shouldOptimize,
        shouldScopeHoist: asset.env.shouldScopeHoist,
      });
    } else if (
      !asset.env.isServer() &&
      !asset.env.isLibrary &&
      directives.includes('use server')
    ) {
      asset.setEnvironment({
        context: 'react-server',
        sourceType: 'module',
        outputFormat: 'commonjs',
        engines: asset.env.engines,
        includeNodeModules: true,
        isLibrary: false,
        sourceMap: asset.env.sourceMap,
        shouldOptimize: asset.env.shouldOptimize,
        shouldScopeHoist: asset.env.shouldScopeHoist,
      });
    } else if (directives.includes('use server-entry')) {
      if (!asset.env.isServer()) {
        throw new Error(
          'use server-entry must be imported in a server environment',
        );
      }
      asset.bundleBehavior = 'isolated';
    }

    // Server actions must always be wrapped so they can be parcelRequired.
    if (directives.includes('use server')) {
      asset.meta.shouldWrap = true;
    }

    for (let dep of dependencies) {
      let d = dependencyFromRust(dep);

      // Add required version range for helpers.
      if (d.meta?.isHelper) {
        let idx = dep.specifier.indexOf('/');
        if (dep.specifier[0] === '@') {
          idx = dep.specifier.indexOf('/', idx + 1);
        }
        let module = idx >= 0 ? dep.specifier.slice(0, idx) : dep.specifier;
        d = {
          ...d,
          range: pkg.dependencies[module],
          resolveFrom: __filename
        };
      }

      if (d.loc && originalMap) {
        d = {
          ...d,
          loc: remapSourceLocation(d.loc, originalMap)
        };
      }

      if (d.env?.loc && originalMap) {
        d = {
          ...d,
          env: {
            ...d.env,
            loc: remapSourceLocation(d.env.loc, originalMap)
          }
        };
      }

      if (asset.env.context !== 'react-client' && d.env?.context === 'react-client') {
        // This is a hack to prevent creating unnecessary shared bundles between actual client code
        // and server code that runs in the client environment (e.g. react).
        asset.isBundleSplittable = false;
      }

      asset.addDependency(d);
    }

    if (hoist_result) {
      asset.symbols.ensure();
      for (let {
        exported,
        local,
        loc,
        is_esm,
      } of hoist_result.exported_symbols) {
        asset.symbols.set(exported, local, convertLoc(loc), {isEsm: is_esm});
      }

      // deps is a map of dependencies that are keyed by placeholder or specifier
      // If a placeholder is present, that is used first since placeholders are
      // hashed with DependencyKind's.
      // If not, the specifier is used along with its specifierType appended to
      // it to separate dependencies with the same specifier.
      let deps = new Map(
        asset
          .getDependencies()
          .map(dep => [dep.meta.placeholder ?? dep.specifier, dep]),
      );
      for (let dep of deps.values()) {
        dep.symbols.ensure();
      }

      for (let {
        source,
        local,
        imported,
        loc,
      } of hoist_result.imported_symbols) {
        let dep = deps.get(source);
        if (!dep) continue;
        dep.symbols.set(imported, local, convertLoc(loc));
      }

      for (let {source, local, imported, loc} of hoist_result.re_exports) {
        let dep = deps.get(source);
        if (!dep) continue;
        if (local === '*' && imported === '*') {
          dep.symbols.set('*', '*', convertLoc(loc), true);
        } else {
          let reExportName =
            dep.symbols.get(imported)?.local ??
            `$${asset.id}$re_export$${local}`;
          asset.symbols.set(local, reExportName);
          dep.symbols.set(imported, reExportName, convertLoc(loc), true);
        }
      }

      for (let specifier of hoist_result.wrapped_requires) {
        let dep = deps.get(specifier);
        if (!dep) continue;
        dep.meta.shouldWrap = true;
      }

      for (let name in hoist_result.dynamic_imports) {
        let dep = deps.get(hoist_result.dynamic_imports[name]);
        if (!dep) continue;
        dep.meta.promiseSymbol = name;
      }

      if (hoist_result.self_references.length > 0) {
        let symbols = new Map();
        for (let name of hoist_result.self_references) {
          // Do not create a self-reference for the `default` symbol unless we have seen an __esModule flag.
          if (
            name === 'default' &&
            !asset.symbols.hasExportSymbol('__esModule')
          ) {
            continue;
          }

          let local = nullthrows(asset.symbols.get(name)).local;
          symbols.set(name, {
            local,
            isWeak: false,
            loc: null,
          });
        }

        // Use the asset id as a unique key if one has not already been set.
        // This lets us create a dependency on the asset itself by using it as a specifier.
        // Using the unique key ensures that the dependency always resolves to the correct asset,
        // even if it came from a transformer that produced multiple assets (e.g. css modules).
        // Also avoids needing a resolution request.
        asset.uniqueKey ||= asset.id;
        asset.addDependency({
          specifier: asset.uniqueKey,
          specifierType: 'esm',
          symbols,
        });
      }

      // Add * symbol if there are CJS exports, no imports/exports at all
      // (and the asset has side effects), or the asset is wrapped.
      // This allows accessing symbols that don't exist without errors in symbol propagation.
      if (
        hoist_result.has_cjs_exports ||
        (!hoist_result.is_esm &&
          asset.sideEffects &&
          deps.size === 0 &&
          Object.keys(hoist_result.exported_symbols).length === 0) ||
        (hoist_result.should_wrap && !asset.symbols.hasExportSymbol('*'))
      ) {
        asset.symbols.set('*', `$${asset.id}$exports`);
      }

      asset.meta.hasCJSExports = hoist_result.has_cjs_exports;
      asset.meta.staticExports = hoist_result.static_cjs_exports;
      asset.meta.shouldWrap ||= hoist_result.should_wrap;
    } else {
      if (symbol_result) {
        let deps = new Map(
          asset
            .getDependencies()
            .map(dep => [dep.meta.placeholder ?? dep.specifier, dep]),
        );
        asset.symbols.ensure();

        for (let {exported, local, loc, source} of symbol_result.exports) {
          let dep = source ? deps.get(source) : undefined;
          asset.symbols.set(
            exported,
            `${dep?.id ?? ''}$${local}`,
            convertLoc(loc),
          );
          if (dep != null) {
            dep.symbols.ensure();
            dep.symbols.set(
              local,
              `${dep?.id ?? ''}$${local}`,
              convertLoc(loc),
              true,
            );
          }
        }

        for (let {source, local, imported, loc} of symbol_result.imports) {
          let dep = deps.get(source);
          if (!dep) continue;
          dep.symbols.ensure();
          dep.symbols.set(imported, local, convertLoc(loc));
        }

        for (let {source, loc} of symbol_result.exports_all) {
          let dep = deps.get(source);
          if (!dep) continue;
          dep.symbols.ensure();
          dep.symbols.set('*', '*', convertLoc(loc), true);
        }

        // Add * symbol if there are CJS exports, no imports/exports at all, or the asset is wrapped.
        // This allows accessing symbols that don't exist without errors in symbol propagation.
        if (
          symbol_result.has_cjs_exports ||
          (!symbol_result.is_esm &&
            deps.size === 0 &&
            symbol_result.exports.length === 0) ||
          (symbol_result.should_wrap && !asset.symbols.hasExportSymbol('*'))
        ) {
          asset.symbols.ensure();
          asset.symbols.set('*', `$${asset.id}$exports`);
        }
      } else {
        // If the asset is wrapped, add * as a fallback
        asset.symbols.ensure();
        asset.symbols.set('*', `$${asset.id}$exports`);
      }

      // For all other imports and requires, mark everything as imported (this covers both dynamic
      // imports and non-top-level requires.)
      for (let dep of asset.getDependencies()) {
        if (dep.symbols.isCleared) {
          dep.symbols.ensure();
          dep.symbols.set('*', `${dep.id}$`);
        }
      }

      if (needs_esm_helpers) {
        asset.addDependency({
          specifier: '@parcel/transformer-js/src/esmodule-helpers.js',
          specifierType: 'esm',
          resolveFrom: __filename,
          env: {
            includeNodeModules: {
              '@parcel/transformer-js': true,
            },
          },
        });
      }
    }

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
