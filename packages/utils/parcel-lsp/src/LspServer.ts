// @flow strict-local
/* eslint-disable no-console */

// import type {Diagnostic as ParcelDiagnostic} from '@parcel/diagnostic';
// import type {FilePath} from '@parcel/types';

// import {
//   createClientPipeTransport,
//   generateRandomPipeName,
// } from 'vscode-jsonrpc';
// import {
//   createConnection,
//   DiagnosticSeverity,
//   ProposedFeatures,
// } from 'vscode-languageserver/node';
// import {DefaultMap, getProgressMessage} from '@parcel/utils';
// import {Reporter} from '@parcel/plugin';
// import invariant from 'assert';
// import path from 'path';
// import nullthrows from 'nullthrows';
// import os from 'os';
// import fs from 'fs';
// import ps from 'ps-node';
// import {promisify} from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
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

import {
  CloseAction,
  ErrorAction,
  LanguageClient,
  LanguageClientOptions,
  MessageTransports,
} from 'vscode-languageclient/node';

import {SocketMessageReader, SocketMessageWriter} from 'vscode-jsonrpc/node';
import * as net from 'net';

import {TextDocument} from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
      },
    },
  };

  console.log({result});
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

connection.onInitialized(() => {
  console.log('initialized!');
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined,
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(_event => {
      connection.console.log('Workspace folder change event received.');
    });
  }
});

function createLanguageClientIfPossible(
  parcelLspDir: string,
  filename: string,
): MessageTransports | undefined {
  let pipeFilename = path.join(parcelLspDir, filename);
  if (!fs.existsSync(pipeFilename)) {
    return;
  }
  let transportName: string;
  try {
    transportName = JSON.parse(
      fs.readFileSync(pipeFilename, {
        encoding: 'utf8',
      }),
    ).transportName;
  } catch (e) {
    // TODO: Handle this
    console.log(e);
    return;
  }
  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used

  let socket = net.connect(transportName);
  return {
    reader: new SocketMessageReader(socket),
    writer: new SocketMessageWriter(socket),
    //Detached true probably
    detached: true,
  };

  // Options to control the language client
  // let clientOptions: LanguageClientOptions = {
  //   errorHandler: {
  //     closed: () => CloseAction.DoNotRestart,
  //     error: () => ErrorAction.Continue,
  //   },
  // };

  // // Create the language client and start the client.
  // let client = new LanguageClient(
  //   'parcel-lsp',
  //   'Parcel LSP',
  //   serverOptions,
  //   clientOptions,
  // );
  // client.onReady().then(() => console.log('ready'));
  // // Start the client. This will also launch the server
  // client.start();
  // console.log('client started');
  // return client;
}
let clients = [];

let parcelLspDir = path.join(os.tmpdir(), 'parcel-lsp');
console.log({parcelLspDir});
for (let filename of fs.readdirSync(parcelLspDir)) {
  console.log({filename});
  let client = createLanguageClientIfPossible(parcelLspDir, filename);
  client?.reader.listen(msg => {
    console.log('MESSAG RECEIVED');
    console.log(msg);
  });

  if (client) {
    clients.push(client);
  }
}

connection.listen();
