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
      case 'buildFailure':
        progressReporter.done();
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
