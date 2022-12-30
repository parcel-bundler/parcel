/* eslint-disable no-unused-vars */
// @flow strict-local
/* eslint-disable no-console */

import type {Diagnostic as ParcelDiagnostic} from '@parcel/diagnostic';
import type {DiagnosticLogEvent, FilePath} from '@parcel/types';
import type {Program, Query} from 'ps-node';
import type {
  DiagnosticSeverity as IDiagnosticSeverity,
  Diagnostic,
  PublishDiagnostic,
} from './protocol';
import type {MessageConnection} from 'vscode-jsonrpc/node';

import {DiagnosticSeverity} from 'vscode-languageserver/node';

import {DefaultMap, getProgressMessage} from '@parcel/utils';
import {Reporter} from '@parcel/plugin';
import invariant from 'assert';
import path from 'path';
import os from 'os';
import fs from 'fs';
import * as ps from 'ps-node';
import {promisify} from 'util';

import {createServer} from './ipc';
import {
  NotificationBuildStatus,
  NotificationWorkspaceDiagnostics,
} from './protocol';

const lookupPid: Query => Program[] = promisify(ps.lookup);

const ignoreFail = func => {
  try {
    func();
  } catch (e) {
    /**/
  }
};

type ParcelSeverity = DiagnosticLogEvent['level'];

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

export default (new Reporter({
  async report({event, logger, options}) {
    switch (event.type) {
      case 'watchStart': {
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
          ignoreFail(() =>
            fs.unlinkSync(path.join(BASEDIR, filename + '.json')),
          );
        }

        server = await createServer(SOCKET_FILE, connection => {
          console.log('got connection');
          connections.push(connection);
          connection.onClose(() => {
            connections = connections.filter(c => c !== connection);
          });

          sendDiagnostics();
        });
        await fs.promises.writeFile(
          META_FILE,
          JSON.stringify({
            projectRoot: options.projectRoot,
            pid: process.pid,
            argv: process.argv,
          }),
        );

        break;
      }

      case 'buildStart': {
        updateBuildState('start');
        clearDiagnostics();
        break;
      }
      case 'buildSuccess':
        updateBuildState('end');
        sendDiagnostics();
        break;
      case 'buildFailure': {
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
  console.log('send', getWorkspaceDiagnostics());
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

function parcelSeverityToLspSeverity(
  parcelSeverity: ParcelSeverity,
): IDiagnosticSeverity {
  switch (parcelSeverity) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'warn':
      return DiagnosticSeverity.Warning;
    case 'info':
      return DiagnosticSeverity.Information;
    case 'verbose':
      return DiagnosticSeverity.Hint;
    default:
      throw new Error('Unknown severity');
  }
}

function normalizeFilePath(filePath: FilePath, projectRoot: FilePath) {
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(projectRoot, filePath);
}
