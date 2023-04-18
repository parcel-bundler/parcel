// @flow
import type {
  // AST,
  // ASTGenerator,
  // BundleBehavior,
  // Dependency,
  DependencyOptions,
  // Environment,
  // EnvironmentOptions,
  EnvMap,
  // FileCreateInvalidation,
  // FilePath,
  JSONObject,
  Meta,
  MutableAsset,
  // MutableAssetSymbols,
  TransformerResult,
  Symbol,
  SourceLocation,
} from '@parcel/types';
// import type {Readable} from 'stream';
import type {SchemaEntity} from '@parcel/utils';
import type {Diagnostic} from '@parcel/diagnostic';
// import type {FileSystem} from '@parcel/fs';
import SourceMap from '@parcel/source-map';
import {Transformer} from '@parcel/plugin';
import {init, transform} from '../native';
import path from 'path';
import browserslist from 'browserslist';
import semver from 'semver';
import nullthrows from 'nullthrows';
import ThrowableDiagnostic, {encodeJSONKeyComponent} from '@parcel/diagnostic';
import {
  validateSchema,
  remapSourceLocation,
  isGlobMatch,
  objectSortedEntriesDeep,
} from '@parcel/utils';
import WorkerFarm from '@parcel/workers';
import pkg from '../package.json';

type TransformResultOuter = {|
  main_module: TransformResult,
  modules: Array<[string, TransformResult]>,
|};

type TransformResult = {|
  code: Buffer,
  map: ?string,
  shebang: ?string,
  dependencies: Array<any /* DependencyDescriptor */>,
  hoist_result: ?any /* HoistResult */,
  symbol_result: ?any /* CollectResult */,
  diagnostics: ?Array<any /* Diagnostic */>,
  needs_esm_helpers: boolean,
  used_env: Set<string>,
  has_node_replacements: boolean,
|};

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

const BROWSER_MAPPING = {
  and_chr: 'chrome',
  and_ff: 'firefox',
  ie_mob: 'ie',
  ios_saf: 'ios',
  op_mob: 'opera',
  and_qq: null,
  and_uc: null,
  baidu: null,
  bb: null,
  kaios: null,
  op_mini: null,
};

// List of browsers to exclude when the esmodule target is specified.
// Based on https://caniuse.com/#feat=es6-module
const ESMODULE_BROWSERS = [
  'not ie <= 11',
  'not edge < 16',
  'not firefox < 60',
  'not chrome < 61',
  'not safari < 11',
  'not opera < 48',
  'not ios_saf < 11',
  'not op_mini all',
  'not android < 76',
  'not blackberry > 0',
  'not op_mob > 0',
  'not and_chr < 76',
  'not and_ff < 68',
  'not ie_mob > 0',
  'not and_uc > 0',
  'not samsung < 8.2',
  'not and_qq > 0',
  'not baidu > 0',
  'not kaios > 0',
];

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
  },
  additionalProperties: false,
};

type PackageJSONConfig = {|
  '@parcel/transformer-js'?: {|
    inlineFS?: boolean,
    inlineEnvironment?: boolean | Array<string>,
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
    }

    return {
      isJSX,
      automaticJSXRuntime,
      jsxImportSource,
      pragma,
      pragmaFrag,
      inlineEnvironment,
      inlineFS,
      reactRefresh,
      decorators,
      useDefineForClassFields,
    };
  },
  async transform({asset, config, options, logger}) {
    let [code, originalMap] = await Promise.all([
      asset.getBuffer(),
      asset.getMap(),
      init,
      loadOnMainThreadIfNeeded(),
    ]);

    let targets;
    if (asset.env.isElectron() && asset.env.engines.electron) {
      targets = {
        electron: semver.minVersion(asset.env.engines.electron)?.toString(),
      };
    } else if (asset.env.isBrowser() && asset.env.engines.browsers) {
      targets = {};

      let browsers = Array.isArray(asset.env.engines.browsers)
        ? asset.env.engines.browsers
        : [asset.env.engines.browsers];

      // If the output format is esmodule, exclude browsers
      // that support them natively so that we transpile less.
      if (asset.env.outputFormat === 'esmodule') {
        browsers = [...browsers, ...ESMODULE_BROWSERS];
      }

      browsers = browserslist(browsers);
      for (let browser of browsers) {
        let [name, version] = browser.split(' ');
        if (BROWSER_MAPPING.hasOwnProperty(name)) {
          name = BROWSER_MAPPING[name];
          if (!name) {
            continue;
          }
        }

        let [major, minor = '0', patch = '0'] = version
          .split('-')[0]
          .split('.');
        if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
          continue;
        }
        let semverVersion = `${major}.${minor}.${patch}`;

        if (targets[name] == null || semver.gt(targets[name], semverVersion)) {
          targets[name] = semverVersion;
        }
      }
    } else if (asset.env.isNode() && asset.env.engines.node) {
      targets = {node: semver.minVersion(asset.env.engines.node)?.toString()};
    }

    let env: EnvMap = {};

    if (!config?.inlineEnvironment) {
      if (options.env.NODE_ENV != null) {
        env.NODE_ENV = options.env.NODE_ENV;
      }

      if (process.env.PARCEL_BUILD_ENV === 'test') {
        env.PARCEL_BUILD_ENV = 'test';
      }
    } else if (Array.isArray(config?.inlineEnvironment)) {
      for (let key in options.env) {
        if (isGlobMatch(key, config.inlineEnvironment)) {
          env[key] = String(options.env[key]);
        }
      }
    } else {
      for (let key in options.env) {
        if (!key.startsWith('npm_')) {
          env[key] = String(options.env[key]);
        }
      }
    }

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

    let result: TransformResultOuter = transform({
      filename: asset.filePath,
      code,
      module_id: asset.id,
      project_root: options.projectRoot,
      replace_env: !asset.env.isNode(),
      side_effects: asset.sideEffects,
      inline_fs: Boolean(config?.inlineFS) && !asset.env.isNode(),
      insert_node_globals:
        !asset.env.isNode() && asset.env.sourceType !== 'script',
      node_replacer: asset.env.isNode(),
      is_browser: asset.env.isBrowser(),
      is_worker: asset.env.isWorker(),
      env,
      is_type_script: asset.type === 'ts' || asset.type === 'tsx',
      is_jsx: isJSX,
      jsx_pragma: config?.pragma,
      jsx_pragma_frag: config?.pragmaFrag,
      automatic_jsx_runtime: Boolean(config?.automaticJSXRuntime),
      jsx_import_source: config?.jsxImportSource,
      is_development: options.mode === 'development',
      react_refresh:
        asset.env.isBrowser() &&
        !asset.env.isLibrary &&
        !asset.env.isWorker() &&
        !asset.env.isWorklet() &&
        Boolean(config?.reactRefresh),
      decorators: Boolean(config?.decorators),
      use_define_for_class_fields: Boolean(config?.useDefineForClassFields),
      targets,
      source_maps: !!asset.env.sourceMap,
      scope_hoist:
        asset.env.shouldScopeHoist && asset.env.sourceType !== 'script',
      source_type: asset.env.sourceType === 'script' ? 'Script' : 'Module',
      supports_module_workers: supportsModuleWorkers,
      is_library: asset.env.isLibrary,
      is_esm_output: asset.env.outputFormat === 'esmodule',
      trace_bailouts: options.logLevel === 'verbose',
      is_swc_helpers: /@swc[/\\]helpers/.test(asset.filePath),
    });

    let convertLoc = loc => {
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

    let x = [
      applyResult(
        asset,
        result.main_module,
        asset.id,
        logger,
        convertLoc,
        supportsModuleWorkers,
        options,
        originalMap,
      ),
      ...result.modules.map<TransformerResult, void>(([id, res]) =>
        applyResult(
          asset,
          res,
          id,
          logger,
          convertLoc,
          supportsModuleWorkers,
          options,
          originalMap,
        ),
      ),
    ];
    // console.log(
    //   asset.filePath,
    //   // require('util').inspect(result.main_module, {depth: Infinity}),
    //   require('util').inspect(
    //     x.map(v => ({...v, content: v.content?.toString()})),
    //     {depth: Infinity},
    //   ),
    // );
    return x;
  },
}): Transformer);

// On linux with older versions of glibc (e.g. CentOS 7), we encounter a segmentation fault
// when worker threads exit due to thread local variables used by SWC. A workaround is to
// also load the native module on the main thread, so that it is not unloaded until process exit.
// See https://github.com/rust-lang/rust/issues/91979.
let isLoadedOnMainThread = false;
async function loadOnMainThreadIfNeeded() {
  if (
    !isLoadedOnMainThread &&
    process.platform === 'linux' &&
    WorkerFarm.isWorker()
  ) {
    // $FlowFixMe
    let {glibcVersionRuntime} = process.report.getReport().header;
    if (glibcVersionRuntime && parseFloat(glibcVersionRuntime) <= 2.17) {
      let api = WorkerFarm.getWorkerApi();
      await api.callMaster({
        location: __dirname + '/loadNative.js',
        args: [],
      });

      isLoadedOnMainThread = true;
    }
  }
}

// class AssetWrapper implements MutableAsset {
//   value: TransformerResult;
//   _id: string;
//   constructor(value: TransformerResult, id: string) {
//     this.value = value;
//     this._id = id;
//   }

//   /** The id of the asset. */
//   get id(): string {
//     return this._id;
//   }
//   get fs(): FileSystem {
//     throw new Error();
//   }
//   get filePath(): FilePath {
//     throw new Error();
//   }
//   get type(): string {
//     throw new Error();
//   }
//   get query(): URLSearchParams {
//     throw new Error();
//   }
//   get env(): Environment {
//     throw new Error();
//   }
//   get isSource(): boolean {
//     throw new Error();
//   }
//   get meta(): Meta {
//     let meta =
//       // $FlowFixMe[cannot-write]
//       // $FlowFixMe[incompatible-type]
//       this.value.meta ?? (this.value.meta = {});
//     return meta;
//   }
//   get bundleBehavior(): ?BundleBehavior {
//     throw new Error();
//   }
//   get isBundleSplittable(): boolean {
//     throw new Error();
//   }
//   get sideEffects(): boolean {
//     throw new Error();
//   }
//   get uniqueKey(): ?string {
//     throw new Error();
//   }
//   get astGenerator(): ?ASTGenerator {
//     throw new Error();
//   }
//   get pipeline(): ?string {
//     throw new Error();
//   }
//   getAST(): Promise<?AST> {
//     throw new Error();
//   }
//   getCode(): Promise<string> {
//     throw new Error();
//   }
//   getBuffer(): Promise<Buffer> {
//     throw new Error();
//   }
//   getStream(): Readable {
//     throw new Error();
//   }
//   getMap(): Promise<?SourceMap> {
//     throw new Error();
//   }
//   getMapBuffer(): Promise<?Buffer> {
//     throw new Error();
//   }
//   getDependencies(): $ReadOnlyArray<Dependency> {
//     return this.value.dependencies;
//   }

//   set type(v: string): string {
//     throw new Error();
//   }
//   set bundleBehavior(v: ?BundleBehavior) {
//     throw new Error();
//   }
//   set isBundleSplittable(v: boolean) {
//     throw new Error();
//   }
//   set sideEffects(v: boolean) {
//     // $FlowFixMe[cannot-write]
//     this.value.sideEffects = v;
//   }
//   get symbols(): MutableAssetSymbols {
//     let that = this;
//     const EMPTY_ITERATOR = {
//       next() {
//         return {done: true};
//       },
//     };

//     return new (class X implements MutableAssetSymbols {
//       /*::
//       @@iterator(): Iterator<[Symbol, {|local: Symbol, loc: ?SourceLocation, meta?: ?Meta|}]> { return ({}: any); }
//       */
//       get isCleared(): boolean {
//         return that.value.symbols == null;
//       }
//       get(exportSymbol: Symbol): ?{|
//         local: Symbol,
//         loc: ?SourceLocation,
//         meta?: ?Meta,
//       |} {
//         nullthrows(that.value.symbols).get(exportSymbol);
//       }
//       hasExportSymbol(exportSymbol: Symbol): boolean {
//         return Boolean(that.value.symbols?.has(exportSymbol));
//       }
//       hasLocalSymbol(local: Symbol): boolean {
//         if (that.value.symbols == null) {
//           return false;
//         }
//         for (let s of that.value.symbols.values()) {
//           if (local === s.local) return true;
//         }
//         return false;
//       }
//       exportSymbols(): Iterable<Symbol> {
//         // $FlowFixMe
//         return that.value.symbols.keys();
//       }
//       // $FlowFixMe
//       [Symbol.iterator]() {
//         return that.value.symbols
//           ? that.value.symbols[Symbol.iterator]()
//           : EMPTY_ITERATOR;
//       }

//       ensure(): void {
//         if (that.value.symbols == null) {
//           // $FlowFixMe[cannot-write]
//           that.value.symbols = new Map();
//         }
//       }
//       set(
//         exportSymbol: Symbol,
//         local: Symbol,
//         loc: ?SourceLocation,
//         meta?: ?Meta,
//       ): void {
//         // $FlowFixMe[incompatible-cast]
//         (nullthrows(that.value.symbols): Map<
//           Symbol,
//           {|loc: ?SourceLocation, local: Symbol, meta?: ?Meta|},
//         >).set(exportSymbol, {
//           local,
//           loc,
//           meta,
//         });
//       }
//       delete(exportSymbol: Symbol) {
//         // $FlowFixMe[incompatible-cast]
//         (nullthrows(that.value.symbols): Map<
//           Symbol,
//           {|loc: ?SourceLocation, local: Symbol, meta?: ?Meta|},
//         >).delete(exportSymbol);
//       }
//     })();
//   }

//   // eslint-disable-next-line no-unused-vars
//   addDependency(v: DependencyOptions): string {
//     let deps: Array<DependencyOptions> =
//       // $FlowFixMe[cannot-write]
//       // $FlowFixMe[incompatible-type]
//       this.value.dependencies ?? (this.value.dependencies = []);
//     deps.push(v);
//     return '';
//   }
//   // eslint-disable-next-line no-unused-vars
//   addURLDependency(url: string, opts: $Shape<DependencyOptions>): string {
//     throw new Error();
//   }
//   // eslint-disable-next-line no-unused-vars
//   invalidateOnFileChange(v: FilePath): void {
//     throw new Error();
//   }
//   // eslint-disable-next-line no-unused-vars
//   invalidateOnFileCreate(v: FileCreateInvalidation): void {
//     throw new Error();
//   }
//   // eslint-disable-next-line no-unused-vars
//   invalidateOnEnvChange(v: string): void {
//     throw new Error();
//   }
//   // eslint-disable-next-line no-unused-vars
//   setCode(v: string): void {
//     throw new Error();
//   }
//   // eslint-disable-next-line no-unused-vars
//   setBuffer(v: Buffer): void {
//     throw new Error();
//   }
//   // eslint-disable-next-line no-unused-vars
//   setStream(v: Readable): void {
//     throw new Error();
//   }
//   // eslint-disable-next-line no-unused-vars
//   setAST(v: AST): void {
//     throw new Error();
//   }
//   isASTDirty(): boolean {
//     throw new Error();
//   }
//   // eslint-disable-next-line no-unused-vars
//   setMap(map: ?SourceMap): void {
//     throw new Error();
//   }
//   // eslint-disable-next-line no-unused-vars
//   setEnvironment(opts: EnvironmentOptions): void {
//     throw new Error();
//   }
// }

function applyResult(
  baseAsset: MutableAsset,
  result: TransformResult,
  uniqueKey: ?string,
  logger,
  convertLoc,
  supportsModuleWorkers,
  options,
  originalMap,
) {
  let {
    dependencies,
    code: compiledCode,
    map,
    shebang,
    hoist_result,
    symbol_result,
    needs_esm_helpers,
    diagnostics,
    // used_env,
    has_node_replacements,
  } = result;

  let asset = {
    type: 'js',
    content: compiledCode,
    uniqueKey,
    meta: {},
    dependencies: ([]: Array<DependencyOptions>),
    map: (null: ?SourceMap),
    symbols: (null: ?Map<
      Symbol,
      {|local: Symbol, loc: ?SourceLocation, meta?: ?Meta|},
    >),
  };

  if (diagnostics) {
    let errors = diagnostics.filter(
      d =>
        d.severity === 'Error' ||
        (d.severity === 'SourceError' && baseAsset.isSource),
    );
    let warnings = diagnostics.filter(
      d =>
        d.severity === 'Warning' ||
        (d.severity === 'SourceError' && !baseAsset.isSource),
    );
    let convertDiagnostic = diagnostic => {
      let message = diagnostic.message;
      if (message === 'SCRIPT_ERROR') {
        let err = SCRIPT_ERRORS[(baseAsset.env.context: string)];
        message = err?.message || SCRIPT_ERRORS.browser.message;
      }

      let res: Diagnostic = {
        message,
        codeFrames: [
          {
            filePath: baseAsset.filePath,
            codeHighlights: diagnostic.code_highlights?.map(highlight => {
              let {start, end} = convertLoc(highlight.loc);
              return {
                message: highlight.message,
                start,
                end,
              };
            }),
          },
        ],
        hints: diagnostic.hints,
      };

      if (diagnostic.documentation_url) {
        res.documentationURL = diagnostic.documentation_url;
      }

      if (diagnostic.show_environment) {
        if (
          baseAsset.env.loc &&
          baseAsset.env.loc.filePath !== baseAsset.filePath
        ) {
          res.codeFrames?.push({
            filePath: baseAsset.env.loc.filePath,
            codeHighlights: [
              {
                start: baseAsset.env.loc.start,
                end: baseAsset.env.loc.end,
                message: 'The environment was originally created here',
              },
            ],
          });
        }

        let err = SCRIPT_ERRORS[(baseAsset.env.context: string)];
        if (err) {
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

  if (has_node_replacements) {
    asset.meta.has_node_replacements = has_node_replacements;
  }

  // TODO
  // for (let env of used_env) {
  //   asset.invalidateOnEnvChange(env);
  // }

  for (let dep of dependencies) {
    if (dep.kind === 'WebWorker') {
      // Use native ES module output if the worker was created with `type: 'module'` and all targets
      // support native module workers. Only do this if parent asset output format is also esmodule so that
      // assets can be shared between workers and the main thread in the global output format.
      let outputFormat;
      if (
        baseAsset.env.outputFormat === 'esmodule' &&
        dep.source_type === 'Module' &&
        supportsModuleWorkers
      ) {
        outputFormat = 'esmodule';
      } else {
        outputFormat =
          baseAsset.env.outputFormat === 'commonjs' ? 'commonjs' : 'global';
      }

      let loc = convertLoc(dep.loc);
      addURLDependency(asset, dep.specifier, {
        loc,
        env: {
          context: 'web-worker',
          sourceType: dep.source_type === 'Module' ? 'module' : 'script',
          outputFormat,
          loc,
        },
        meta: {
          webworker: true,
          placeholder: dep.placeholder,
        },
      });
    } else if (dep.kind === 'ServiceWorker') {
      let loc = convertLoc(dep.loc);
      addURLDependency(asset, dep.specifier, {
        loc,
        needsStableName: true,
        env: {
          context: 'service-worker',
          sourceType: dep.source_type === 'Module' ? 'module' : 'script',
          outputFormat: 'global', // TODO: module service worker support
          loc,
        },
        meta: {
          placeholder: dep.placeholder,
        },
      });
    } else if (dep.kind === 'Worklet') {
      let loc = convertLoc(dep.loc);
      addURLDependency(asset, dep.specifier, {
        loc,
        env: {
          context: 'worklet',
          sourceType: 'module',
          outputFormat: 'esmodule', // Worklets require ESM
          loc,
        },
        meta: {
          placeholder: dep.placeholder,
        },
      });
    } else if (dep.kind === 'Url') {
      addURLDependency(asset, dep.specifier, {
        bundleBehavior: 'isolated',
        loc: convertLoc(dep.loc),
        meta: {
          placeholder: dep.placeholder,
        },
      });
      // TODO
      // } else if (dep.kind === 'File') {
      //   asset.invalidateOnFileChange(dep.specifier);
    } else {
      let meta: JSONObject = {kind: dep.kind};
      if (dep.attributes) {
        meta.importAttributes = dep.attributes;
      }

      if (dep.placeholder) {
        meta.placeholder = dep.placeholder;
      }

      let env;
      if (dep.kind === 'DynamicImport') {
        // https://html.spec.whatwg.org/multipage/webappapis.html#hostimportmoduledynamically(referencingscriptormodule,-modulerequest,-promisecapability)
        if (
          baseAsset.env.isWorklet() ||
          baseAsset.env.context === 'service-worker'
        ) {
          let loc = convertLoc(dep.loc);
          let diagnostic = {
            message: `import() is not allowed in ${
              baseAsset.env.isWorklet() ? 'worklets' : 'service workers'
            }.`,
            codeFrames: [
              {
                filePath: baseAsset.filePath,
                codeHighlights: [
                  {
                    start: loc.start,
                    end: loc.end,
                  },
                ],
              },
            ],
            hints: ['Try using a static `import`.'],
          };

          if (baseAsset.env.loc) {
            diagnostic.codeFrames.push({
              filePath: baseAsset.env.loc.filePath,
              codeHighlights: [
                {
                  start: baseAsset.env.loc.start,
                  end: baseAsset.env.loc.end,
                  message: 'The environment was originally created here',
                },
              ],
            });
          }

          throw new ThrowableDiagnostic({
            diagnostic,
          });
        }

        // If all of the target engines support dynamic import natively,
        // we can output native ESM if scope hoisting is enabled.
        // Only do this for scripts, rather than modules in the global
        // output format so that assets can be shared between the bundles.
        let outputFormat = baseAsset.env.outputFormat;
        if (
          baseAsset.env.sourceType === 'script' &&
          baseAsset.env.shouldScopeHoist &&
          baseAsset.env.supports('dynamic-import', true)
        ) {
          outputFormat = 'esmodule';
        }

        env = {
          sourceType: 'module',
          outputFormat,
          loc: convertLoc(dep.loc),
        };
      }

      // Always bundle helpers, even with includeNodeModules: false, except if this is a library.
      let isHelper =
        // TODO
        dep.specifier.startsWith('@swc/helpers') &&
        !dep.specifier.startsWith('@swc/helpers/src') &&
        dep.is_helper &&
        !(
          dep.specifier.endsWith('/jsx-runtime') ||
          dep.specifier.endsWith('/jsx-dev-runtime')
        );
      if (isHelper && !baseAsset.env.isLibrary) {
        env = {
          ...env,
          includeNodeModules: true,
        };
      }

      // Add required version range for helpers.
      let range;
      if (isHelper) {
        let idx = dep.specifier.indexOf('/');
        if (dep.specifier[0] === '@') {
          idx = dep.specifier.indexOf('/', idx + 1);
        }
        let module = idx >= 0 ? dep.specifier.slice(0, idx) : dep.specifier;
        range = pkg.dependencies[module];
      }

      addDependency(asset, {
        specifier: dep.specifier,
        specifierType: dep.kind === 'Require' ? 'commonjs' : 'esm',
        loc: convertLoc(dep.loc),
        priority: dep.kind === 'DynamicImport' ? 'lazy' : 'sync',
        isOptional: dep.is_optional,
        meta,
        resolveFrom: isHelper ? __filename : undefined,
        range,
        env,
      });
    }
  }

  asset.meta.id = uniqueKey;
  if (hoist_result) {
    asset.symbols ??= new Map();
    for (let {exported, local, loc, is_esm} of hoist_result.exported_symbols) {
      asset.symbols.set(exported, {
        local,
        loc: convertLoc(loc),
        meta: {isEsm: is_esm},
      });
    }

    // deps is a map of dependencies that are keyed by placeholder or specifier
    // If a placeholder is present, that is used first since placeholders are
    // hashed with DependencyKind's.
    // If not, the specifier is used along with its specifierType appended to
    // it to separate dependencies with the same specifier.
    let deps = new Map(
      asset.dependencies.map(dep => [
        nullthrows(dep.meta).placeholder ?? dep.specifier,
        dep,
      ]),
    );
    for (let dep of deps.values()) {
      ensureDependencySymbols(dep);
    }

    for (let {source, local, imported, loc} of hoist_result.imported_symbols) {
      let dep = deps.get(source);
      if (!dep) continue;
      setDependencySymbols(dep, imported, local, convertLoc(loc), false);
    }

    for (let {source, local, imported, loc} of hoist_result.re_exports) {
      let dep = deps.get(source);
      if (!dep) continue;
      if (local === '*' && imported === '*') {
        setDependencySymbols(dep, '*', '*', convertLoc(loc), true);
      } else {
        let reExportName =
          getDependencySymbols(dep).get(imported)?.local ??
          `$${baseAsset.id}$re_export$${local}`;
        nullthrows(asset.symbols).set(local, {local: reExportName, loc: null});
        setDependencySymbols(
          dep,
          imported,
          reExportName,
          convertLoc(loc),
          true,
        );
      }
    }

    for (let specifier of hoist_result.wrapped_requires) {
      let dep = deps.get(specifier);
      if (!dep) continue;
      nullthrows(dep.meta).shouldWrap = true;
    }

    for (let name in hoist_result.dynamic_imports) {
      let dep = deps.get(hoist_result.dynamic_imports[name]);
      if (!dep) continue;
      nullthrows(dep.meta).promiseSymbol = name;
    }

    if (hoist_result.self_references.length > 0) {
      let symbols = new Map();
      for (let name of hoist_result.self_references) {
        // Do not create a self-reference for the `default` symbol unless we have seen an __esModule flag.
        if (
          name === 'default' &&
          !nullthrows(asset.symbols).has('__esModule')
        ) {
          continue;
        }

        let local = nullthrows(nullthrows(asset.symbols).get(name)).local;
        symbols.set(name, {
          local,
          isWeak: false,
          loc: null,
        });
      }

      addDependency(asset, {
        specifier: `./${path.basename(baseAsset.filePath)}`,
        specifierType: 'esm',
        symbols,
      });
    }

    // Add * symbol if there are CJS exports, no imports/exports at all, or the asset is wrapped.
    // This allows accessing symbols that don't exist without errors in symbol propagation.
    if (
      hoist_result.has_cjs_exports ||
      (!hoist_result.is_esm &&
        deps.size === 0 &&
        Object.keys(hoist_result.exported_symbols).length === 0) ||
      (hoist_result.should_wrap && !nullthrows(asset.symbols).has('*'))
    ) {
      nullthrows(asset.symbols).set('*', {
        local: `$${baseAsset.id}$exports`,
        loc: null,
      });
    }

    asset.meta.hasCJSExports = hoist_result.has_cjs_exports;
    asset.meta.staticExports = hoist_result.static_cjs_exports;
    asset.meta.shouldWrap = hoist_result.should_wrap;
  } else {
    if (symbol_result) {
      let deps = new Map(
        asset.dependencies.map(dep => [
          nullthrows(dep.meta).placeholder ?? dep.specifier,
          dep,
        ]),
      );
      asset.symbols ??= new Map();

      for (let {exported, local, loc, source} of symbol_result.exports) {
        let dep = source ? deps.get(source) : undefined;
        nullthrows(asset.symbols).set(exported, {
          local: `${dep?.id ?? ''}$${local}`,
          loc: convertLoc(loc),
        });
        if (dep != null) {
          ensureDependencySymbols(dep);
          setDependencySymbols(
            dep,
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
        ensureDependencySymbols(dep);
        setDependencySymbols(dep, imported, local, convertLoc(loc), false);
      }

      for (let {source, loc} of symbol_result.exports_all) {
        let dep = deps.get(source);
        if (!dep) continue;
        ensureDependencySymbols(dep);
        setDependencySymbols(dep, '*', '*', convertLoc(loc), true);
      }

      // Add * symbol if there are CJS exports, no imports/exports at all, or the asset is wrapped.
      // This allows accessing symbols that don't exist without errors in symbol propagation.
      if (
        symbol_result.has_cjs_exports ||
        (!symbol_result.is_esm &&
          deps.size === 0 &&
          symbol_result.exports.length === 0) ||
        (symbol_result.should_wrap && !nullthrows(asset.symbols).has('*'))
      ) {
        asset.symbols ??= new Map();
        asset.symbols.set('*', {local: `$${baseAsset.id}$exports`, loc: null});
      }
    } else {
      // If the asset is wrapped, add * as a fallback
      asset.symbols ??= new Map();
      nullthrows(asset.symbols).set('*', {
        local: `$${baseAsset.id}$exports`,
        loc: null,
      });
    }

    // For all other imports and requires, mark everything as imported (this covers both dynamic
    // imports and non-top-level requires.)
    for (let dep of asset.dependencies) {
      if (dep.symbols == null) {
        ensureDependencySymbols(dep);
        setDependencySymbols(dep, '*', `${dep.id}$`, null, false);
      }
    }

    if (needs_esm_helpers) {
      addDependency(asset, {
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
  if (map) {
    let sourceMap = new SourceMap(options.projectRoot);
    sourceMap.addVLQMap(JSON.parse(map));
    if (originalMap) {
      sourceMap.extends(originalMap);
    }
    asset.map = sourceMap;
  }

  return asset;
}

function getDependencyId(opts: DependencyOptions): string {
  let id =
    // (opts.sourceAssetId ?? '') +
    opts.specifier +
    (opts.env ? JSON.stringify(objectSortedEntriesDeep(opts.env)) : '') +
    // (opts.target ? JSON.stringify(opts.target) : '') +
    (opts.pipeline ?? '') +
    opts.specifierType +
    (opts.bundleBehavior ?? '') +
    (opts.priority ?? 'sync') +
    (opts.packageConditions ? JSON.stringify(opts.packageConditions) : '');
  return id;
}

let assetDependencyIdCache = new WeakMap();

function addDependency(asset, {meta = {}, ...opts}: DependencyOptions) {
  let dep = {...opts, meta};
  let id = getDependencyId(dep);
  let dependencyIds = assetDependencyIdCache.get(asset);
  if (!dependencyIds) {
    dependencyIds = new Set(asset.dependencies.map(d => getDependencyId(d)));
    assetDependencyIdCache.set(asset, dependencyIds);
  }
  if (dependencyIds.has(id)) {
    return;
  }
  dependencyIds.add(id);
  asset.dependencies.push(dep);
}

function addURLDependency(asset, url: string, opts) {
  addDependency(asset, {
    specifier: url,
    specifierType: 'url',
    priority: 'lazy',
    ...opts,
  });
}

function ensureDependencySymbols(dep: DependencyOptions) {
  // $FlowFixMe[cannot-write]
  dep.symbols ??= new Map();
}

function getDependencySymbols(dep: DependencyOptions): Map<
  Symbol,
  {|
    isWeak: boolean,
    loc: ?SourceLocation,
    local: Symbol,
    meta?: Meta,
  |},
> {
  // $FlowFixMe[incompatible-return]
  return nullthrows(dep.symbols);
}

function setDependencySymbols(
  dep: DependencyOptions,
  exportSymbol: Symbol,
  local: Symbol,
  loc: ?SourceLocation,
  isWeak: ?boolean,
) {
  let symbols: Map<
    Symbol,
    {|
      isWeak: boolean,
      loc: ?SourceLocation,
      local: Symbol,
      meta?: Meta,
    |},
    // $FlowFixMe[incompatible-type]
  > = nullthrows(dep.symbols);
  symbols.set(exportSymbol, {
    local,
    loc: loc,
    isWeak: (symbols.get(exportSymbol)?.isWeak ?? true) && (isWeak ?? false),
  });
}
