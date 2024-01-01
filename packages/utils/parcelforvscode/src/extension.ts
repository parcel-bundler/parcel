/* eslint-disable @typescript-eslint/naming-convention */
import type {ExtensionContext} from 'vscode';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import {addImportersView} from './importersView';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
  // The server is implemented in node
  let serverModule = path.join(context.extensionPath, 'lib', 'server.js');
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
    documentSelector: [{scheme: 'file', pattern: '**/*'}],
  };
  // Create the language client and start the client.
  client = new LanguageClient('parcel', 'Parcel', serverOptions, clientOptions);

  // Start the client. This will also launch the server
  client.start();

  addImportersView(context, client);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }

  const LSP_SENTINEL_FILEPATH = path.join(fs.realpathSync(os.tmpdir()), 'parcel-lsp', 'lsp-server');

  if (fs.existsSync(LSP_SENTINEL_FILEPATH)) {
    fs.rmSync(LSP_SENTINEL_FILEPATH);
  } 

  return client.stop();
}
