// @flow strict-local
/* eslint-disable no-console */

import type {Diagnostic as ParcelDiagnostic} from '@parcel/diagnostic';
import type {FilePath} from '@parcel/types';

import {createClientPipeTransport} from 'vscode-jsonrpc';
import {createConnection, DiagnosticSeverity} from 'vscode-languageserver/node';
import {DefaultMap, getProgressMessage} from '@parcel/utils';
import {Reporter} from '@parcel/plugin';
import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';

// flowlint-next-line unclear-type:off
type WorkDoneProgressServerReporter = any;
// flowlint-next-line unclear-type:off
type LspDiagnostic = any;

type ParcelSeverity = 'error' | 'warn' | 'info' | 'verbose';

let connectionPromise;
let connection;
let progressReporter: ?ProgressReporter;
let watchEnded = false;
let fileDiagnostics: DefaultMap<
  string,
  Array<LspDiagnostic>,
> = new DefaultMap(() => []);

export default (new Reporter({
  async report({event, options}) {
    switch (event.type) {
      case 'watchStart': {
        //TODO: include pid in createServerPipeTransport
        connectionPromise = (async () => {
          let transport = await createClientPipeTransport('/tmp/parcel');
          connection = await createConnection(
            ...(await transport.onConnected()),
          );

          connection.onInitialize(() => {
            console.debug('Connection is initialized');
            invariant(connection != null);
            connection.window.showInformationMessage('hi');
          });
          invariant(connection != null);
          connection.listen();
          console.debug('connection listening...');
          return connection;
        })();
        progressReporter = new ProgressReporter();
        nullthrows(connectionPromise).then(connection => {
          if (fileDiagnostics.size > 0) {
            if (connection != null) {
              for (let [uri, diagnostics] of fileDiagnostics) {
                connection.sendDiagnostics({uri, diagnostics});
              }
            }
          }

          if (watchEnded) {
            connection.dispose();
          }
        });
        break;
      }
      case 'buildStart': {
        nullthrows(progressReporter).begin();
        let filePaths = [...fileDiagnostics.keys()];
        fileDiagnostics.clear();

        if (connection != null) {
          await Promise.all(
            filePaths.map(uri =>
              connection.window.sendDiagnostics({uri, diagnostics: []}),
            ),
          );
        }

        break;
      }
      case 'buildSuccess':
        nullthrows(progressReporter).done();
        if (connection != null) {
          for (let [uri, diagnostics] of fileDiagnostics) {
            connection.sendDiagnostics({uri, diagnostics});
          }
        }
        break;
      case 'buildFailure': {
        updateDiagnostics(
          fileDiagnostics,
          event.diagnostics,
          'error',
          options.projectRoot,
        );

        if (connection != null) {
          const _connection = connection;
          for (let [uri, diagnostics] of fileDiagnostics) {
            _connection.sendDiagnostics({uri, diagnostics});
          }
        }
        nullthrows(progressReporter).done();
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
            fileDiagnostics,
            event.diagnostics,
            event.level,
            options.projectRoot,
          );
        }
        break;
      case 'buildProgress': {
        let message = getProgressMessage(event);
        if (message != null) {
          nullthrows(progressReporter).report(message);
        }
        break;
      }
      case 'watchEnd':
        watchEnded = true;
        if (connectionPromise == null) {
          break;
        }
        if (connection != null) {
          connection.dispose();
        }
        connectionPromise = null;
        connection = null;
        console.debug('connection disposed of');
        break;
    }
  },
}): Reporter);

class ProgressReporter {
  progressReporterPromise: ?Promise<WorkDoneProgressServerReporter>;
  lastMessage: ?string;
  begin() {
    this.progressReporterPromise = (async () => {
      let connection = await nullthrows(connectionPromise);
      let reporter = await connection.window.createWorkDoneProgress();
      reporter.begin('Parcel');
      return reporter;
    })();
    this.progressReporterPromise.then(reporter => {
      if (this.lastMessage != null) {
        reporter.report(this.lastMessage);
      }
    });
  }
  async done() {
    if (this.progressReporterPromise == null) {
      this.begin();
    }
    invariant(this.progressReporterPromise != null);
    (await this.progressReporterPromise).done();
  }
  async report(message: string) {
    if (this.progressReporterPromise == null) {
      this.lastMessage = message;
      this.begin();
    } else {
      (await this.progressReporterPromise).report(message);
    }
  }
}

function updateDiagnostics(
  fileDiagnostics: DefaultMap<string, Array<LspDiagnostic>>,
  parcelDiagnostics: Array<ParcelDiagnostic>,
  parcelSeverity: ParcelSeverity,
  projectRoot: FilePath,
): void {
  let severity = parcelSeverityToLspSeverity(parcelSeverity);
  for (let diagnostic of parcelDiagnostics) {
    let filePath =
      diagnostic.filePath != null
        ? normalizeFilePath(diagnostic.filePath, projectRoot)
        : null;

    let range = diagnostic.codeFrame?.codeHighlights[0];
    if (filePath != null && range) {
      fileDiagnostics.get(`file://${filePath}`).push({
        range: {
          start: {
            line: range.start.line - 1,
            character: range.start.column - 1,
          },
          end: {
            line: range.end.line - 1,
            character: range.end.column,
          },
        },
        source: diagnostic.origin,
        message: diagnostic.message,
        severity,
      });
    }
  }
}

function parcelSeverityToLspSeverity(parcelSeverity: ParcelSeverity): mixed {
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
