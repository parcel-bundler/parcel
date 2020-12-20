// @flow
import type {Diagnostic} from '@parcel/diagnostic';
import type {Assets, CodeMirrorDiagnostic, REPLOptions} from '../utils';
import type {MemoryFS} from '@parcel/fs';

import {expose, proxy} from 'comlink';
import Parcel, {createWorkerFarm} from '@parcel/core';
// import {MemoryFS} from '@parcel/fs';
// $FlowFixMe
import {ExtendedMemoryFS} from '@parcel/fs';
// import SimplePackageInstaller from './SimplePackageInstaller';
// import {NodePackageManager} from '@parcel/package-manager';
import configRepl from '@parcel/config-repl';
import {generatePackageJson, nthIndex} from '../utils/';
import path from 'path';
import {yarnInstall} from './yarn.js';

const workerFarm = createWorkerFarm();

export type BundleOutput =
  | {|
      type: 'success',
      bundles: Array<{|
        name: string,
        content: string,
        size: number,
        time: number,
      |}>,
      buildTime: number,
      graphs: ?Array<{|name: string, content: string|}>,
      sourcemaps: ?mixed,
    |}
  | {|
      type: 'failure',
      error?: Error,
      diagnostics: Map<string, Array<CodeMirrorDiagnostic>>,
    |};

expose({
  bundle,
  watch,
  ready: new Promise(res => workerFarm.once('ready', () => res())),
});

const PathUtils = {
  APP_DIR: '/app',
  DIST_DIR: '/app/dist',
  CACHE_DIR: '/app/.parcel-cache',
  fromAssetPath(str) {
    return '/app/' + str;
  },
  toAssetPath(str) {
    return str.startsWith('/app/') ? str.slice(5) : str;
  },
};

function removeTrailingNewline(text: string): string {
  if (text[text.length - 1] === '\n') {
    return text.slice(0, -1);
  } else {
    return text;
  }
}
async function convertDiagnostics(inputFS, diagnostics: Array<Diagnostic>) {
  let parsedDiagnostics = new Map<string, Array<CodeMirrorDiagnostic>>();
  for (let diagnostic of diagnostics) {
    let {filePath = '', codeFrame, origin} = diagnostic;
    let list = parsedDiagnostics.get(PathUtils.toAssetPath(filePath));
    if (!list) {
      list = [];
      parsedDiagnostics.set(PathUtils.toAssetPath(filePath), list);
    }

    if (codeFrame) {
      for (let {start, end, message} of codeFrame.codeHighlights) {
        let code =
          codeFrame.code ??
          (await inputFS.readFile(
            path.resolve(PathUtils.APP_DIR, filePath),
            'utf8',
          ));

        let from = nthIndex(code, '\n', start.line - 1) + start.column;
        let to = nthIndex(code, '\n', end.line - 1) + end.column;

        list.push({
          from,
          to,
          severity: 'error',
          source: origin || 'info',
          message: message || diagnostic.message,
        });
      }
    } else {
      list.push({
        from: 0,
        to: 0,
        severity: 'error',
        source: origin || 'info',
        message: diagnostic.message,
      });
    }
  }
  return parsedDiagnostics;
}

const fs: MemoryFS = new ExtendedMemoryFS(workerFarm);
// $FlowFixMe
globalThis.fs = fs;

async function setup(assets, options) {
  await fs.writeFile('/.parcelrc', JSON.stringify(configRepl, null, 2));

  let graphs = options.renderGraphs ? [] : null;
  if (graphs && options.renderGraphs) {
    // $FlowFixMe
    globalThis.PARCEL_DUMP_GRAPHVIZ = (name, content) =>
      graphs.push({name, content});
    globalThis.PARCEL_DUMP_GRAPHVIZ.mode = options.renderGraphs;
  }

  // TODO only create new instance if options/entries changed
  let entries = assets
    .filter(a => a.isEntry)
    .map(a => PathUtils.fromAssetPath(a.name));
  const bundler = new Parcel({
    entries,
    disableCache: true,
    cacheDir: PathUtils.CACHE_DIR,
    distDir: PathUtils.DIST_DIR,
    mode: 'production',
    hot: null,
    logLevel: 'verbose',
    patchConsole: false,
    workerFarm,
    defaultConfig: '@parcel/config-repl',
    inputFS: fs,
    outputFS: fs,
    minify: options.minify,
    publicUrl: options.publicUrl || undefined,
    scopeHoist: options.scopeHoist,
    sourceMaps: options.sourceMaps,
    // packageManager: new NodePackageManager(
    //   memFS,
    //   new SimplePackageInstaller(memFS),
    // ),
  });

  return {bundler, graphs};
}

async function collectResult(result, graphs, fs) {
  let [output, sourcemaps] = result;
  if (output.success) {
    let bundleContents = [];
    for (let {filePath, size, time} of output.success.bundles) {
      bundleContents.push({
        name: PathUtils.toAssetPath(filePath),
        content: removeTrailingNewline(await fs.readFile(filePath, 'utf8')),
        size,
        time,
      });
    }

    return {
      type: 'success',
      bundles: bundleContents,
      buildTime: output.success.buildTime,
      graphs,
      sourcemaps,
    };
  } else {
    return {
      type: 'failure',
      diagnostics: await convertDiagnostics(fs, output.failure),
    };
  }
}

async function bundle(
  assets: Assets,
  options: REPLOptions,
  progress: string => void,
): Promise<BundleOutput> {
  const resultFromReporter = Promise.all([
    new Promise(res => {
      // $FlowFixMe
      globalThis.PARCEL_JSON_LOGGER_STDOUT = d => {
        switch (d.type) {
          case 'buildSuccess':
            res({success: d});
            break;
          case 'buildFailure': {
            res({failure: d.message});
            break;
          }
        }
      };
      globalThis.PARCEL_JSON_LOGGER_STDERR =
        globalThis.PARCEL_JSON_LOGGER_STDOUT;
    }),
    options.viewSourcemaps
      ? new Promise(res => {
          // $FlowFixMe
          globalThis.PARCEL_SOURCEMAP_VISUALIZER = v => {
            res(v);
          };
        })
      : null,
  ]);

  const {bundler, graphs} = await setup(assets, options);

  await fs.mkdirp('/app');

  for (let f of await fs.readdir('/app')) {
    if (
      f === '.yarn' ||
      f === 'node_modules' ||
      f === 'yarn.lock' ||
      f === '.parcel-cache' ||
      f === 'package.json'
    ) {
      continue;
    }
    await fs.rimraf('/app/' + f);
  }

  let oldPackageJson = (await fs.exists('/app/package.json'))
    ? await fs.readFile('/app/package.json', 'utf8')
    : null;
  let newPackageJson =
    assets.find(({name}) => name === 'package.json')?.content ??
    generatePackageJson(options);

  if (!oldPackageJson || oldPackageJson !== newPackageJson) {
    await fs.writeFile('/app/package.json', newPackageJson);
  }

  await fs.mkdirp('/app/src');
  for (let {name, content} of assets) {
    if (name === 'package.json') continue;
    let p = PathUtils.fromAssetPath(name);
    await fs.mkdirp(path.dirname(p));
    await fs.writeFile(p, content);
  }

  await yarnInstall(options, fs, PathUtils.APP_DIR, v => {
    if (v.data.includes('Resolution step')) {
      progress('Yarn: Resolving');
    } else if (v.data.includes('Fetch step')) {
      progress('Yarn: Fetching');
    } else if (v.data.includes('Link step')) {
      progress('Yarn: Linking');
    }
  });

  progress('Bundling');

  try {
    let error;
    try {
      await bundler.run();
    } catch (e) {
      error = e;
    }

    let result = await Promise.race([
      resultFromReporter,
      new Promise(res => setTimeout(() => res(null), 100)),
    ]);
    if (result) {
      return await collectResult(result, graphs, fs);
    } else {
      throw error;
    }
  } catch (error) {
    console.error(error);
    return {
      type: 'failure',
      error: error,
      diagnostics:
        error.diagnostics && (await convertDiagnostics(fs, error.diagnostics)),
    };
  }
}

async function watch(
  assets: Assets,
  options: REPLOptions,
  onBuild: BundleOutput => void,
): Promise<{|
  unsubscribe: () => Promise<mixed>,
  writeAssets: Assets => Promise<mixed>,
|}> {
  const reporterEvents = new EventTarget();
  // $FlowFixMe
  globalThis.PARCEL_JSON_LOGGER_STDOUT = d => {
    switch (d.type) {
      case 'buildSuccess':
        Promise.resolve().then(() =>
          reporterEvents.dispatchEvent(
            new CustomEvent('build', {detail: {success: d}}),
          ),
        );
        break;
      case 'buildFailure': {
        Promise.resolve().then(() =>
          reporterEvents.dispatchEvent(
            new CustomEvent('build', {detail: {failure: d.message}}),
          ),
        );
        break;
      }
    }
  };
  globalThis.PARCEL_JSON_LOGGER_STDERR = globalThis.PARCEL_JSON_LOGGER_STDOUT;

  let {bundler, graphs} = await setup(assets, options);
  await fs.mkdirp('/app');

  async function writeAssets(assets) {
    await fs.writeFile('/app/package.json', generatePackageJson(options));
    await fs.writeFile('/.parcelrc', JSON.stringify(configRepl, null, 2));
    await fs.writeFile('/app/yarn.lock', '');
    await fs.mkdirp('/app/src');
    for (let {name, content} of assets) {
      let p = PathUtils.fromAssetPath(name);
      await fs.mkdirp(path.dirname(p));
      await fs.writeFile(p, content);
    }
  }

  writeAssets(assets);

  reporterEvents.addEventListener('build', async (e: Event) => {
    // $FlowFixMe
    let {detail} = e;
    let result = await collectResult([detail], graphs, fs);
    onBuild(result);
  });

  return proxy({
    unsubscribe: (await bundler.watch()).unsubscribe,
    writeAssets,
  });
}
