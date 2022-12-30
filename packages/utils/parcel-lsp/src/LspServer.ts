/* eslint-disable no-console */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  createConnection,
  DiagnosticRefreshRequest,
  DidChangeConfigurationNotification,
  DocumentDiagnosticParams,
  DocumentDiagnosticReport,
  DocumentDiagnosticReportKind,
  DocumentDiagnosticRequest,
  DocumentUri,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  WorkDoneProgressServerReporter,
  WorkspaceDiagnosticRequest,
  WorkspaceDiagnosticParams,
  WorkspaceDiagnosticReport,
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
  RequestDocumentDiagnostics,
} from './protocol';

const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;
let hasDiagnosticsRefreshSupport = false;

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
  hasDiagnosticsRefreshSupport = Boolean(
    capabilities.workspace?.diagnostics?.refreshSupport,
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      diagnosticProvider: {
        workspaceDiagnostics: false,
        interFileDependencies: true,
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

// connection.onRequest(
//   WorkspaceDiagnosticRequest.type,
//   (params: WorkspaceDiagnosticParams): WorkspaceDiagnosticReport => {
//     console.log('WorkspaceDiagnosticRequest', params.partialResultToken);
//     let value: WorkspaceDiagnosticReport = {
//       items: [],
//     };
//     return value;
//   },
// );

connection.onRequest(
  DocumentDiagnosticRequest.type,
  async (
    params: DocumentDiagnosticParams,
  ): Promise<DocumentDiagnosticReport> => {
    // if (params.previousResultId === buildId) {
    //   return {
    //     kind: DocumentDiagnosticReportKind.Unchanged,
    //     resultId: buildId,
    //   };
    // }
    console.log('DocumentDiagnosticRequest', params.textDocument.uri);

    let client = clients.values().next().value as Client | undefined;

    let result;
    if (client) {
      result = await client.connection.sendRequest(
        RequestDocumentDiagnostics,
        params.textDocument.uri,
      );

      if (result) {
        client.uris.add(params.textDocument.uri);
      }
    }

    return {
      kind: DocumentDiagnosticReportKind.Full,
      // resultId: buildId,
      items: [
        // ...(workspaceDiagnostics.get(params.textDocument.uri) ?? []),
        ...(result ?? []),
      ],
    };
  },
);

connection.listen();

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

function sendDiagnosticsRefresh() {
  if (hasDiagnosticsRefreshSupport) {
    connection.sendRequest(DiagnosticRefreshRequest.type);
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
      sendDiagnosticsRefresh();
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

  client.onClose(() => {
    console.log('close', uris);
    clients.delete(metafile);
    sendDiagnosticsRefresh();
    return Promise.all(
      [...uris].map(uri => connection.sendDiagnostics({uri, diagnostics: []})),
    );
  });

  sendDiagnosticsRefresh();
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
