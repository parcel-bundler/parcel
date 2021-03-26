// @flow
import {
  createConnection,
  Diagnostic as LspDiagnostic,
  DiagnosticSeverity,
  WorkDoneProgressServerReporter,
} from 'vscode-languageserver/node';
import {DefaultMap} from '@parcel/utils';
import type {Diagnostic as ParcelDiagnostic} from '@parcel/diagnostic';
import type {FilePath} from '@parcel/types';
import path from 'path';
import invariant from 'assert';
import {createClientPipeTransport} from 'vscode-jsonrpc';

import {Reporter} from '@parcel/plugin';
import util from 'util';

let connection;
let progressReporter: WorkDoneProgressServerReporter;
let fileDiagnostics: DefaultMap<
  string,
  Array<LspDiagnostic>,
> = new DefaultMap(() => []);

type ParcelSeverity = 'error' | 'warn' | 'info' | 'verbose';
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
function updateDiagnostics(
  fileDiagnostics: DefaultMap<string, Array<LspDiagnostic>>,
  parcelDiagnostics: Array<ParcelDiagnostic>,
  parcelSeverity: ParcelSeverity,
  projectRoot: FilePath,
): void {
  let severity = parcelSeverityToLspSeverity(parcelSeverity);
  for (let diagnostic of parcelDiagnostics) {
    let filePath =
      diagnostic.filePath &&
      (path.isAbsolute(diagnostic.filePath)
        ? diagnostic.filePath
        : path.join(projectRoot, diagnostic.filePath));
    let range = diagnostic.codeFrame?.codeHighlights[0];
    if (filePath && range) {
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

export default (new Reporter({
  async report({event, options}) {
    switch (event.type) {
      case 'watchStart': {
        //TODO: include pid in createServerPipeTransport
        let transport = await createClientPipeTransport('/tmp/parcel');
        connection = createConnection(...(await transport.onConnected()));
        connection.onInitialize(params => {
          console.log('Connection is initialized');
          console.log(params);
          connection.window.showInformationMessage('hi');
        });
        invariant(connection != null);
        connection.listen();
        console.log('connection listening...');
        break;
      }
      case 'buildStart':
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
      case 'buildProgress':
        progressReporter.report(event.phase);
        break;
      case 'watchEnd':
        if (connection == null) {
          break;
        }
        connection.dispose();
        connection = null;
        console.log('connection disposed of');
        break;
    }
  },
}): Reporter);
