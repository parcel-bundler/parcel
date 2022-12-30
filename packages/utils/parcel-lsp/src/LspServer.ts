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
  DocumentUri,
} from 'vscode-languageserver/node';

import {
  createServerPipeTransport,
  createMessageConnection,
  MessageConnection,
} from 'vscode-jsonrpc/node';
import * as invariant from 'assert';

import {TextDocument} from 'vscode-languageserver-textdocument';
import * as watcher from '@parcel/watcher';
import {
  NotificationBuildStatus,
  NotificationWorkspaceDiagnostics,
} from './protocol';

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

type Client = {
  connection: MessageConnection;
  uris: Set<DocumentUri>;
};

const BASEDIR = fs.realpathSync(path.join(os.tmpdir(), 'parcel-lsp'));
let progressReporter = new ProgressReporter();
let clients: Map<string, Client> = new Map();

function createClient(metafile: string) {
  let socketfilepath = metafile.slice(0, -5);
  let [reader, writer] = createServerPipeTransport(socketfilepath);
  let client = createMessageConnection(reader, writer);
  client.listen();

  let uris = new Set<DocumentUri>();

  client.onNotification(NotificationBuildStatus, (state, message) => {
    console.log('got NotificationBuildStatus', state, message);
    if (state === 'start') {
      progressReporter.begin();
      for (let uri of uris) {
        connection.sendDiagnostics({uri, diagnostics: []});
      }
    } else if (state === 'progress' && message != null) {
      progressReporter.report(message);
    } else if (state === 'end') {
      progressReporter.done();
    }
  });

  client.onNotification(NotificationWorkspaceDiagnostics, diagnostics => {
    console.log('got NotificationWorkspaceDiagnostics', diagnostics);
    for (let d of diagnostics) {
      uris.add(d.uri);
      connection.sendDiagnostics(d);
    }
  });

  return {connection: client, uris};
  client.onClose(() => {
    console.log('close', uris);
    clients.delete(metafile);
    return Promise.all(
      [...uris].map(uri => connection.sendDiagnostics({uri, diagnostics: []})),
    );
  });

  clients.set(metafile, {connection: client, uris});
}

fs.mkdirSync(BASEDIR, {recursive: true});
// Search for currently running Parcel processes in the parcel-lsp dir.
// Create an IPC client connection for each running process.
for (let filename of fs.readdirSync(BASEDIR)) {
  if (!filename.endsWith('.json')) continue;
  let filepath = path.join(BASEDIR, filename);
  createClient(filepath);
  console.log('connected initial', filepath);
}

// Watch for new Parcel processes in the parcel-lsp dir, and disconnect the
// client for each corresponding connection when a Parcel process ends
watcher.subscribe(BASEDIR, async (err, events) => {
  if (err) {
    throw err;
  }

  for (let event of events) {
    console.log('event', event);
    if (event.type === 'create' && event.path.endsWith('.json')) {
      createClient(event.path);
      console.log('connected watched', event.path);
    } else if (event.type === 'delete' && event.path.endsWith('.json')) {
      let existing = clients.get(event.path);
      console.log('existing', event.path, existing);
      if (existing) {
        clients.delete(event.path);
        existing.connection.end();
        console.log('disconnected watched', event.path);
      }
    }
  }
});

connection.listen();
