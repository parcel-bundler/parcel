// @flow
import type {Diagnostic} from '@parcel/diagnostic';
import type {Assets, CodeMirrorDiagnostic, REPLOptions} from '../utils';

import {expose} from 'comlink';
import Parcel, {createWorkerFarm} from '@parcel/core';
import {MemoryFS} from '@parcel/fs';
// import SimplePackageInstaller from './SimplePackageInstaller';
// import {NodePackageManager} from '@parcel/package-manager';
// import {prettifyTime} from '@parcel/utils';
import configRepl from '@parcel/config-repl';

import {generatePackageJson, nthIndex} from '../utils/';

const workerFarm = createWorkerFarm();

import path from 'path';

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
  ready: new Promise(res => workerFarm.once('ready', () => res())),
});

const PathUtils = {
  DIST_DIR: '/dist',
  CACHE_DIR: '/.parcel-cache',
  fromAssetPath(str) {
    return '/' + str;
  },
  toAssetPath(str) {
    return str[0] === '/' ? str.slice(1) : str;
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
      let {start, end} = codeFrame.codeHighlights[0];
      let code = codeFrame.code ?? (await inputFS.readFile(filePath, 'utf8'));

      let from = nthIndex(code, '\n', start.line - 1) + start.column;
      let to = nthIndex(code, '\n', end.line - 1) + end.column;

      list.push({
        from,
        to,
        severity: 'error',
        source: origin || 'info',
        message: codeFrame.codeHighlights[0].message || diagnostic.message,
      });
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

async function bundle(
  assets: Assets,
  options: REPLOptions,
): Promise<BundleOutput> {
  let graphs = options.renderGraphs ? [] : null;
  if (graphs && options.renderGraphs) {
    // $FlowFixMe
    globalThis.PARCEL_DUMP_GRAPHVIZ = (name, content) =>
      graphs.push({name, content});
    globalThis.PARCEL_DUMP_GRAPHVIZ.mode = options.renderGraphs;
  }

  const resultFromReporter = Promise.all([
    new Promise(res => {
      // $FlowFixMe
      globalThis.PARCEL_JSON_LOGGER_STDOUT = d => {
        switch (d.type) {
          // case 'buildStart':
          //   console.log('📦 Started');
          //   break;
          // case 'buildProgress': {
          //   let phase = d.phase.charAt(0).toUpperCase() + d.phase.slice(1);
          //   let filePath = d.filePath || d.bundleFilePath;
          //   console.log(`🕓 ${phase} ${filePath ? filePath : ''}`);
          //   break;
          // }
          case 'buildSuccess':
            // console.log(`✅ Succeded in ${/* prettifyTime */ d.buildTime}`);
            // console.group('Output');
            // for (let {filePath} of d.bundles) {
            //   console.log(
            //     '%c%s:\n%c%s',
            //     'font-weight: bold',
            //     filePath,
            //     'font-family: monospace',
            //     await memFS.readFile(filePath, 'utf8'),
            //   );
            // }
            // console.groupEnd();
            res({success: d});
            break;
          case 'buildFailure': {
            // console.log(`❗️`, d);
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

  const fs = new MemoryFS(workerFarm);

  // $FlowFixMe
  globalThis.fs = fs;

  // TODO only create new instance if options/entries changed
  let entries = assets
    .filter(a => a.isEntry)
    .map(a => PathUtils.fromAssetPath(a.name));
  const b = new Parcel({
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

  await fs.writeFile('/package.json', generatePackageJson(options));
  await fs.writeFile('/.parcelrc', JSON.stringify(configRepl, null, 2));
  await fs.writeFile('/yarn.lock', '');

  await fs.mkdirp('/src');
  for (let {name, content} of assets) {
    let p = PathUtils.fromAssetPath(name);
    await fs.mkdirp(path.dirname(p));
    await fs.writeFile(p, content);
  }

  try {
    let error;
    try {
      await b.run();
    } catch (e) {
      error = e;
    }

    let result = await Promise.race([
      resultFromReporter,
      new Promise(res => setTimeout(() => res(null), 100)),
    ]);
    if (result) {
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
