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

// flowlint-next-line unclear-type:off
type WorkDoneProgressServerReporter = any;
// flowlint-next-line unclear-type:off
type LspDiagnostic = any;

type ParcelSeverity = 'error' | 'warn' | 'info' | 'verbose';

let connection;
let progressReporter: WorkDoneProgressServerReporter;
let fileDiagnostics: DefaultMap<
  string,
  Array<LspDiagnostic>,
> = new DefaultMap(() => []);

export default (new Reporter({
  async report({event, options}) {
    switch (event.type) {
      case 'watchStart': {
        //TODO: include pid in createServerPipeTransport
        let transport = await createClientPipeTransport('/tmp/parcel');
        connection = createConnection(...(await transport.onConnected()));
        connection.onInitialize(() => {
          console.debug('Connection is initialized');
          invariant(connection != null);
          connection.window.showInformationMessage('hi');
        });
        invariant(connection != null);
        connection.listen();
        console.debug('connection listening...');
        break;
      }
      case 'buildStart':
        invariant(connection != null);
        progressReporter = await connection.window.createWorkDoneProgress();
        progressReporter.begin('Parcel');
        break;
      case 'buildSuccess':
        fileDiagnostics.clear();
        progressReporter.done();
        break;
      case 'buildFailure': {
        updateDiagnostics(
          fileDiagnostics,
          event.diagnostics,
          'error',
          options.projectRoot,
        );
        for (let [uri, diagnostics] of fileDiagnostics) {
          invariant(connection != null);
          connection.sendDiagnostics({uri, diagnostics});
        }
        fileDiagnostics.clear();
        progressReporter.done();
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
          progressReporter.report(message);
        }
        break;
      }
      case 'watchEnd':
        if (connection == null) {
          break;
        }
        invariant(connection != null);
        connection.dispose();
        connection = null;
        console.debug('connection disposed of');
        break;
    }
  },
}): Reporter);

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
