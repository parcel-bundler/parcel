// @flow
import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
  WorkDoneProgressServerReporter,
} from 'vscode-languageserver/node';
import {DefaultMap} from '@parcel/utils';

import invariant from 'assert';
import {createClientPipeTransport} from 'vscode-jsonrpc';

import {Reporter} from '@parcel/plugin';

let connection;
let progressReporter: WorkDoneProgressServerReporter;

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
        progressReporter.done();
        break;
      case 'buildFailure': {
        let fileDiagnostics = new DefaultMap(() => []);
        for (let diagnostic of event.diagnostics) {
          let range = diagnostic.codeFrame?.codeHighlights[0];
          if (diagnostic.filePath && range) {
            fileDiagnostics.get(diagnostic.filePath).push({
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
            });
          }
        }
        for (let [fileName, diagnostics] of fileDiagnostics) {
          connection.sendDiagnostics({uri: `file://${fileName}`, diagnostics});
        }
        progressReporter.done();
        break;
      }
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
