// @flow
import * as net from 'net';
import type {
  MessageReader,
  MessageWriter,
  MessageConnection,
} from 'vscode-jsonrpc/node';
import {
  createMessageConnection,
  SocketMessageReader,
  SocketMessageWriter,
} from 'vscode-jsonrpc/node';

function createClientPipeTransport(
  pipeName: string,
  onConnected: (reader: MessageReader, writer: MessageWriter) => void,
): Promise<{|close: () => Promise<void>|}> {
  return new Promise((resolve, reject) => {
    let server: net.Server = net.createServer((socket: net.Socket) => {
      onConnected(
        new SocketMessageReader(socket),
        new SocketMessageWriter(socket),
      );
    });
    server.on('error', reject);
    server.listen(pipeName, () => {
      server.removeListener('error', reject);
      resolve({
        close() {
          return new Promise((res, rej) => {
            server.close(e => {
              if (e) rej(e);
              else res();
            });
          });
        },
      });
    });
  });
}

export function createServer(
  filename: string,
  setup: (connection: MessageConnection) => void,
): Promise<{|close: () => Promise<void>|}> {
  return createClientPipeTransport(
    filename,
    (reader: MessageReader, writer: MessageWriter) => {
      let connection = createMessageConnection(reader, writer);
      connection.listen();

      setup(connection);
    },
  );
}
