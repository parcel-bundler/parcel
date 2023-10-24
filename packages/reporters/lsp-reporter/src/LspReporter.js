// @flow strict-local

import type {Diagnostic as ParcelDiagnostic} from '@parcel/diagnostic';
import type {BundleGraph, FilePath, PackagedBundle} from '@parcel/types';
import type {Program, Query} from 'ps-node';
import type {Diagnostic, DocumentUri} from 'vscode-languageserver';
import type {MessageConnection} from 'vscode-jsonrpc/node';
import type {ParcelSeverity} from './utils';

import {
  DefaultMap,
  getProgressMessage,
  makeDeferredWithPromise,
} from '@parcel/utils';
import {Reporter} from '@parcel/plugin';
import path from 'path';
import os from 'os';
import url from 'url';
import fs from 'fs';
import nullthrows from 'nullthrows';
import * as ps from 'ps-node';
import {promisify} from 'util';

import {createServer} from './ipc';
import {
  type PublishDiagnostic,
  NotificationBuildStatus,
  NotificationWorkspaceDiagnostics,
  RequestDocumentDiagnostics,
  RequestImporters,
} from '@parcel/lsp-protocol';

import {
  DiagnosticSeverity,
  DiagnosticTag,
  normalizeFilePath,
  parcelSeverityToLspSeverity,
} from './utils';
import type {FSWatcher} from 'fs';

const lookupPid: Query => Program[] = promisify(ps.lookup);

const ignoreFail = func => {
  try {
    func();
  } catch (e) {
    /**/
  }
};

const BASEDIR = fs.realpathSync(path.join(os.tmpdir(), 'parcel-lsp'));
const SOCKET_FILE = path.join(BASEDIR, `parcel-${process.pid}`);
const META_FILE = path.join(BASEDIR, `parcel-${process.pid}.json`);

let workspaceDiagnostics: DefaultMap<
  string,
  Array<Diagnostic>,
> = new DefaultMap(() => []);

const getWorkspaceDiagnostics = (): Array<PublishDiagnostic> =>
  [...workspaceDiagnostics].map(([uri, diagnostics]) => ({uri, diagnostics}));

let server;
let connections: Array<MessageConnection> = [];

let bundleGraphDeferrable =
  makeDeferredWithPromise<?BundleGraph<PackagedBundle>>();
let bundleGraph: Promise<?BundleGraph<PackagedBundle>> =
  bundleGraphDeferrable.promise;

let watchStarted = false;
let lspStarted = false;
let watchStartPromise;

const LSP_SENTINEL_FILENAME = 'lsp-server';
const LSP_SENTINEL_FILE = path.join(BASEDIR, LSP_SENTINEL_FILENAME);

async function watchLspActive(): Promise<FSWatcher> {
  // Check for lsp-server when reporter is first started
  try {
    await fs.promises.access(LSP_SENTINEL_FILE, fs.constants.F_OK);
    lspStarted = true;
  } catch {
    //
  }

  return fs.watch(BASEDIR, (eventType: string, filename: string) => {
    switch (eventType) {
      case 'rename':
        if (filename === LSP_SENTINEL_FILENAME) {
          fs.access(LSP_SENTINEL_FILE, fs.constants.F_OK, err => {
            if (err) {
              lspStarted = false;
            } else {
              lspStarted = true;
            }
          });
        }
    }
  });
}

async function doWatchStart() {
  await fs.promises.mkdir(BASEDIR, {recursive: true});

  // For each existing file, check if the pid matches a running process.
  // If no process matches, delete the file, assuming it was orphaned
  // by a process that quit unexpectedly.
  for (let filename of fs.readdirSync(BASEDIR)) {
    if (filename.endsWith('.json')) continue;
    let pid = parseInt(filename.slice('parcel-'.length), 10);
    let resultList = await lookupPid({pid});
    if (resultList.length > 0) continue;
    fs.unlinkSync(path.join(BASEDIR, filename));
    ignoreFail(() => fs.unlinkSync(path.join(BASEDIR, filename + '.json')));
  }

  server = await createServer(SOCKET_FILE, connection => {
    // console.log('got connection');
    connections.push(connection);
    connection.onClose(() => {
      connections = connections.filter(c => c !== connection);
    });

    connection.onRequest(RequestDocumentDiagnostics, async uri => {
      let graph = await bundleGraph;
      if (!graph) return;

      return getDiagnosticsUnusedExports(graph, uri);
    });

    connection.onRequest(RequestImporters, async params => {
      let graph = await bundleGraph;
      if (!graph) return null;

      return getImporters(graph, params);
    });

    sendDiagnostics();
  });
  await fs.promises.writeFile(
    META_FILE,
    JSON.stringify({
      projectRoot: process.cwd(),
      pid: process.pid,
      argv: process.argv,
    }),
  );
}

watchLspActive();

export default (new Reporter({
  async report({event, options}) {
    if (event.type === 'watchStart') {
      watchStarted = true;
    }

    if (watchStarted && lspStarted) {
      if (!watchStartPromise) {
        watchStartPromise = doWatchStart();
      }
      await watchStartPromise;
    }

    switch (event.type) {
      case 'watchStart': {
        break;
      }

      case 'buildStart': {
        bundleGraphDeferrable = makeDeferredWithPromise();
        bundleGraph = bundleGraphDeferrable.promise;
        updateBuildState('start');
        clearDiagnostics();
        break;
      }
      case 'buildSuccess':
        bundleGraphDeferrable.deferred.resolve(event.bundleGraph);
        updateBuildState('end');
        sendDiagnostics();
        break;
      case 'buildFailure': {
        bundleGraphDeferrable.deferred.resolve(undefined);
        updateDiagnostics(event.diagnostics, 'error', options.projectRoot);
        updateBuildState('end');
        sendDiagnostics();
        break;
      }
      case 'log':
        if (
          event.diagnostics != null &&
          (event.level === 'error' ||
            event.level === 'warn' ||
            event.level === 'info' ||
            event.level === 'verbose')
        ) {
          updateDiagnostics(
            event.diagnostics,
            event.level,
            options.projectRoot,
          );
        }
        break;
      case 'buildProgress': {
        let message = getProgressMessage(event);
        if (message != null) {
          updateBuildState('progress', message);
        }
        break;
      }
      case 'watchEnd':
        connections.forEach(c => c.end());
        await server.close();
        ignoreFail(() => fs.unlinkSync(META_FILE));
        break;
    }
  },
}): Reporter);

function updateBuildState(
  state: 'start' | 'progress' | 'end',
  message: string | void,
) {
  connections.forEach(c =>
    c.sendNotification(NotificationBuildStatus, state, message),
  );
}

function clearDiagnostics() {
  workspaceDiagnostics.clear();
}
function sendDiagnostics() {
  // console.log('send', getWorkspaceDiagnostics());
  connections.forEach(c =>
    c.sendNotification(
      NotificationWorkspaceDiagnostics,
      getWorkspaceDiagnostics(),
    ),
  );
}

function updateDiagnostics(
  parcelDiagnostics: Array<ParcelDiagnostic>,
  parcelSeverity: ParcelSeverity,
  projectRoot: FilePath,
): void {
  for (let diagnostic of parcelDiagnostics) {
    const codeFrames = diagnostic.codeFrames;
    if (codeFrames == null) {
      continue;
    }

    const firstCodeFrame = codeFrames[0];
    const filePath = firstCodeFrame.filePath;
    if (filePath == null) {
      continue;
    }

    // We use the first highlight of the first codeFrame as the main Diagnostic,
    // and we place everything else in the current Parcel diagnostic
    // in relatedInformation
    // https://code.visualstudio.com/api/references/vscode-api#DiagnosticRelatedInformation
    const firstFrameHighlight = codeFrames[0].codeHighlights[0];
    if (firstFrameHighlight == null) {
      continue;
    }

    const relatedInformation = [];
    for (const codeFrame of codeFrames) {
      for (const highlight of codeFrame.codeHighlights) {
        const filePath = codeFrame.filePath;
        if (highlight === firstFrameHighlight || filePath == null) {
          continue;
        }

        relatedInformation.push({
          location: {
            uri: `file://${normalizeFilePath(filePath, projectRoot)}`,
            range: {
              start: {
                line: highlight.start.line - 1,
                character: highlight.start.column - 1,
              },
              end: {
                line: highlight.end.line - 1,
                character: highlight.end.column,
              },
            },
          },
          message: highlight.message ?? diagnostic.message,
        });
      }
    }

    workspaceDiagnostics
      .get(`file://${normalizeFilePath(filePath, projectRoot)}`)
      .push({
        range: {
          start: {
            line: firstFrameHighlight.start.line - 1,
            character: firstFrameHighlight.start.column - 1,
          },
          end: {
            line: firstFrameHighlight.end.line - 1,
            character: firstFrameHighlight.end.column,
          },
        },
        source: diagnostic.origin,
        severity: parcelSeverityToLspSeverity(parcelSeverity),
        message:
          diagnostic.message +
          (firstFrameHighlight.message == null
            ? ''
            : ' ' + firstFrameHighlight.message),
        relatedInformation,
      });
  }
}

function getDiagnosticsUnusedExports(
  bundleGraph: BundleGraph<PackagedBundle>,
  document: string,
): Array<Diagnostic> {
  let filename = url.fileURLToPath(document);
  let diagnostics = [];

  let asset = bundleGraph.traverse((node, context, actions) => {
    if (node.type === 'asset' && node.value.filePath === filename) {
      actions.stop();
      return node.value;
    }
  });

  if (asset) {
    const generateDiagnostic = (loc, type) => ({
      range: {
        start: {
          line: loc.start.line - 1,
          character: loc.start.column - 1,
        },
        end: {
          line: loc.end.line - 1,
          character: loc.end.column,
        },
      },
      source: '@parcel/core',
      severity: DiagnosticSeverity.Hint,
      message: `Unused ${type}.`,
      tags: [DiagnosticTag.Unnecessary],
    });

    let usedSymbols = bundleGraph.getUsedSymbols(asset);
    if (usedSymbols) {
      for (let [exported, symbol] of asset.symbols) {
        if (!usedSymbols.has(exported)) {
          if (symbol.loc) {
            diagnostics.push(generateDiagnostic(symbol.loc, 'export'));
          }
        }
      }
      // if (usedSymbols.size === 0 && asset.sideEffects !== false) {
      //   diagnostics.push({
      //     range: {
      //       start: {
      //         line: 0,
      //         character: 0,
      //       },
      //       end: {
      //         line: 0,
      //         character: 1,
      //       },
      //     },
      //     source: '@parcel/core',
      //     severity: DiagnosticSeverity.Warning,
      //     message: `Asset has no used exports, but is not marked as sideEffect-free so it cannot be excluded automatically.`,
      //   });
      // }
    }

    for (let dep of asset.getDependencies()) {
      let usedSymbols = bundleGraph.getUsedSymbols(dep);
      if (usedSymbols) {
        for (let [exported, symbol] of dep.symbols) {
          if (!usedSymbols.has(exported) && symbol.isWeak && symbol.loc) {
            diagnostics.push(generateDiagnostic(symbol.loc, 'reexport'));
          }
        }
      }
    }
  }
  return diagnostics;
}

// function getDefinition(
//   bundleGraph: BundleGraph<PackagedBundle>,
//   document: string,
//   position: Position,
// ): Array<LocationLink> | void {
//   let filename = url.fileURLToPath(document);

//   let asset = bundleGraph.traverse((node, context, actions) => {
//     if (node.type === 'asset' && node.value.filePath === filename) {
//       actions.stop();
//       return node.value;
//     }
//   });

//   if (asset) {
//     for (let dep of bundleGraph.getDependencies(asset)) {
//       let loc = dep.loc;
//       if (loc && isInRange(loc, position)) {
//         let resolution = bundleGraph.getResolvedAsset(dep);
//         if (resolution) {
//           return [
//             {
//               originSelectionRange: {
//                 start: {
//                   line: loc.start.line - 1,
//                   character: loc.start.column - 1,
//                 },
//                 end: {line: loc.end.line - 1, character: loc.end.column},
//               },
//               targetUri: `file://${resolution.filePath}`,
//               targetRange: RANGE_DUMMY,
//               targetSelectionRange: RANGE_DUMMY,
//             },
//           ];
//         }
//       }
//     }
//   }
// }

function getImporters(
  bundleGraph: BundleGraph<PackagedBundle>,
  document: string,
): Array<DocumentUri> | null {
  let filename = url.fileURLToPath(document);

  let asset = bundleGraph.traverse((node, context, actions) => {
    if (node.type === 'asset' && node.value.filePath === filename) {
      actions.stop();
      return node.value;
    }
  });

  if (asset) {
    let incoming = bundleGraph.getIncomingDependencies(asset);
    return incoming
      .filter(dep => dep.sourcePath != null)
      .map(dep => `file://${nullthrows(dep.sourcePath)}`);
  }
  return null;
}
