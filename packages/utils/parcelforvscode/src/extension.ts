import * as path from 'path';
import {workspace, ExtensionContext} from 'vscode';

import {
  createServerPipeTransport,
  LanguageClient,
  LanguageClientOptions,
  MessageTransports,
  SocketMessageReader,
  SocketMessageWriter,
} from 'vscode-languageclient/node';
import * as net from 'net';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  async function serverOptions(): Promise<MessageTransports> {
    let socket = net.connect('/tmp/parcel');
    return {
      reader: new SocketMessageReader(socket),
      writer: new SocketMessageWriter(socket),
      //Detached true probably
    };
  }

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {};

  // Create the language client and start the client.
  client = new LanguageClient(
    'languageServerExample',
    'Language Server Example',
    serverOptions,
    clientOptions,
  );

  client.onReady().then(() => console.log('ready'));
  // Start the client. This will also launch the server
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
