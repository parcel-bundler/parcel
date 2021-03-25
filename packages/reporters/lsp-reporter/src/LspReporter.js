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
} from 'vscode-languageserver/node';

import invariant from 'assert';
import {createServerPipeTransport} from 'vscode-jsonrpc';

import {Reporter} from '@parcel/plugin';

let connection;

export default (new Reporter({
  report({event, options}) {
    switch (event.type) {
      case 'watchStart': {
        //TODO: include pid in createServerPipeTransport
        connection = createConnection(...createServerPipeTransport('Parcel'));
        connection.listen();
        console.log('connection listening...');
        break;
      }
      case 'watchEnd':
        invariant(connection != null);
        connection.dispose();
        connection = null;
        console.log('connection disposed of');
        break;
    }
  },
}): Reporter);
