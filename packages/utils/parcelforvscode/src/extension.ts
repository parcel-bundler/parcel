import * as path from 'path';
import {workspace, ExtensionContext} from 'vscode';

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  // The server is implemented in node
  let serverModule = require.resolve('@parcel/lsp');
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  let debugOptions = {execArgv: ['--nolazy', '--inspect=6009']};

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  let serverOptions: ServerOptions = {
    run: {module: serverModule, transport: TransportKind.ipc},
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [{scheme: 'file', language: 'plaintext'}],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: workspace.createFileSystemWatcher('**/.clientrc'),
    },
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    'languageServerExample',
    'Language Server Example',
    serverOptions,
    clientOptions,
  );

  // Start the client. This will also launch the server
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

// import * as path from 'path';
// import * as fs from 'fs';
// import * as os from 'os';
// import {ExtensionContext} from 'vscode';

// import {
//   CloseAction,
//   ErrorAction,
//   LanguageClient,
//   LanguageClientOptions,
//   MessageTransports,
//   SocketMessageReader,
//   SocketMessageWriter,
// } from 'vscode-languageclient/node';
// import * as net from 'net';

// let clients: LanguageClient[] = [];
// let watcher: fs.FSWatcher;

// function createLanguageClientIfPossible(
//   parcelLspDir: string,
//   filename: string,
// ): LanguageClient | undefined {
//   let pipeFilename = path.join(parcelLspDir, filename);
//   if (!fs.existsSync(pipeFilename)) {
//     return;
//   }
//   let transportName: string;
//   try {
//     transportName = JSON.parse(
//       fs.readFileSync(pipeFilename, {
//         encoding: 'utf8',
//       }),
//     ).transportName;
//   } catch (e) {
//     // TODO: Handle this
//     console.log(e);
//     return;
//   }
//   // If the extension is launched in debug mode then the debug server options are used
//   // Otherwise the run options are used
//   async function serverOptions(): Promise<MessageTransports> {
//     let socket = net.connect(transportName);
//     return {
//       reader: new SocketMessageReader(socket),
//       writer: new SocketMessageWriter(socket),
//       //Detached true probably
//       detached: true,
//     };
//   }

//   // Options to control the language client
//   let clientOptions: LanguageClientOptions = {
//     errorHandler: {
//       closed: () => CloseAction.DoNotRestart,
//       error: () => ErrorAction.Continue,
//     },
//   };

//   // Create the language client and start the client.
//   let client = new LanguageClient(
//     'parcel-lsp',
//     'Parcel LSP',
//     serverOptions,
//     clientOptions,
//   );
//   client.onReady().then(() => console.log('ready'));
//   // Start the client. This will also launch the server
//   client.start();
//   console.log('client started');
//   return client;
// }

// export function activate(context: ExtensionContext) {
//   let parcelLspDir = path.join(os.tmpdir(), 'parcel-lsp');
//   for (let filename of fs.readdirSync(parcelLspDir)) {
//     let client = createLanguageClientIfPossible(parcelLspDir, filename);
//     if (client) {
//       clients.push(client);
//     }
//   }

//   watcher = fs.watch(parcelLspDir, (event, filename) => {
//     switch (event) {
//       case 'rename':
//       case 'change': {
//         let client = createLanguageClientIfPossible(parcelLspDir, filename);
//         if (client) {
//           clients.push(client);
//         }
//         break;
//       }
//     }
//   });
// }

// export async function deactivate() {
//   watcher?.close();
//   await Promise.all(clients.map(client => client.stop()));
//   clients = [];
// }
