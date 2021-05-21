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
  WorkDoneProgressServerReporter,
} from 'vscode-languageserver/node';

import {
  CloseAction,
  ErrorAction,
  LanguageClient,
  LanguageClientOptions,
  MessageTransports,
} from 'vscode-languageclient/node';

import * as net from 'net';
import * as invariant from 'assert';
import nullthrows from 'nullthrows';
import {IPC} from 'node-ipc';

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

class ProgressReporter {
  progressReporterPromise?: Promise<WorkDoneProgressServerReporter> | null;
  lastMessage?: string;
  begin() {
    this.progressReporterPromise = (async () => {
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
    this.progressReporterPromise = null;
  }
  async report(message: string) {
    if (this.progressReporterPromise == null) {
      this.lastMessage = message;
      this.begin();
    } else {
      let r = await this.progressReporterPromise;
      r.report(message);
    }
  }
}

function createLanguageClientIfPossible(
  parcelLspDir: string,
  filename: string,
): any {
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

  let client = new IPC();
  client.config.id = `parcel-lsp-${process.pid}`;
  client.config.retry = 1500;
  client.connectTo(transportName, function() {
    client.of[transportName].on(
      'message', //any event or message type your server listens for
      function(data: any) {
        switch (data.type) {
          case 'parcelBuildEnd':
            progressReporter.done();
            break;

          case 'parcelFileDiagnostics':
            for (let [uri, diagnostics] of data.fileDiagnostics) {
              connection.sendDiagnostics({uri, diagnostics});
            }
            break;

          case 'parcelBuildSuccess':
            progressReporter.done();
            break;

          case 'parcelBuildStart':
            progressReporter.begin();
            break;

          case 'parcelBuildProgress':
            progressReporter.report(data.message);
            break;

          default:
            throw new Error();
        }
      },
    );
  });

  return client;
}

let progressReporter = new ProgressReporter();

let clients = [];

let parcelLspDir = path.join(os.tmpdir(), 'parcel-lsp');
for (let filename of fs.readdirSync(parcelLspDir)) {
  let client = createLanguageClientIfPossible(parcelLspDir, filename);
  if (client) {
    clients.push(client);
  }
}

connection.listen();
