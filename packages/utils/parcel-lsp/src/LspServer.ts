/* eslint-disable no-console */

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
  CodeActionKind,
  CodeAction,
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
import * as watcher from '@parcel/watcher';
import {connect} from 'tls';

type IPCType = InstanceType<typeof IPC>;

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
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
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

connection.onCodeAction(params => {
  let diagnostic = params.context.diagnostics[0];
  if (diagnostic) {
    let action: CodeAction = {
      title: 'xyz',
      kind: CodeActionKind.QuickFix,
      diagnostics: params.context.diagnostics,
      edit: {
        changes: {
          [params.textDocument.uri]: [
            {
              range: diagnostic.range,
              // range: {
              //   start: {line: 3, character: 11},
              //   end: {line: 3, character: 20},
              // },
              newText: `new URL('foo.js', import.meta.url)`,
            },
          ],
        },
      },
    };

    return [action];
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

function createIPCClientIfPossible(
  parcelLspDir: string,
  filePath: string,
): {client: IPCType; uris: Set<string>} | undefined {
  let transportName: string;
  try {
    transportName = JSON.parse(
      fs.readFileSync(filePath, {
        encoding: 'utf8',
      }),
    ).transportName;
  } catch (e) {
    // TODO: Handle this
    console.log(e);
    return;
  }

  let uris: Set<string> = new Set();
  let client = new IPC();
  client.config.id = `parcel-lsp-${process.pid}`;
  client.config.retry = 1500;
  client.connectTo(transportName, function () {
    client.of[transportName].on(
      'message', //any event or message type your server listens for
      function (data: any) {
        switch (data.type) {
          case 'parcelBuildEnd':
            progressReporter.done();
            break;

          case 'parcelFileDiagnostics':
            for (let [uri, diagnostics] of data.fileDiagnostics) {
              connection.sendDiagnostics({uri, diagnostics});
              uris.add(uri);
            }
            break;

          case 'parcelBuildSuccess':
            progressReporter.done();
            break;

          case 'parcelBuildStart':
            uris.clear();
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

  return {client, uris};
}

let progressReporter = new ProgressReporter();
let clients: Map<string, {client: IPCType; uris: Set<string>}> = new Map();
let parcelLspDir = path.join(fs.realpathSync(os.tmpdir()), 'parcel-lsp');
fs.mkdirSync(parcelLspDir, {recursive: true});
// Search for currently running Parcel processes in the parcel-lsp dir.
// Create an IPC client connection for each running process.
for (let filename of fs.readdirSync(parcelLspDir)) {
  const filepath = path.join(parcelLspDir, filename);
  let client = createIPCClientIfPossible(parcelLspDir, filepath);
  if (client) {
    clients.set(filepath, client);
  }
}

// Watch for new Parcel processes in the parcel-lsp dir, and disconnect the
// client for each corresponding connection when a Parcel process ends
watcher.subscribe(parcelLspDir, async (err, events) => {
  if (err) {
    throw err;
  }

  for (let event of events) {
    if (event.type === 'create') {
      let client = createIPCClientIfPossible(parcelLspDir, event.path);
      if (client) {
        clients.set(event.path, client);
      }
    } else if (event.type === 'delete') {
      let existing = clients.get(event.path);
      if (existing) {
        clients.delete(event.path);
        for (let id of Object.keys(existing.client.of)) {
          existing.client.disconnect(id);
        }
        await Promise.all(
          [...existing.uris].map(uri =>
            connection.sendDiagnostics({uri, diagnostics: []}),
          ),
        );
      }
    }
  }
});

connection.listen();
