// @flow
import type {InitialParcelOptions, FilePath} from '@parcel/types';
// $FlowFixMe
import {Worker, receiveMessageOnPort} from 'worker_threads';

export class ParcelNode {
  signal: Int32Array;
  port: MessagePort;
  exited: boolean;

  constructor(options: InitialParcelOptions) {
    // $FlowFixMe
    this.signal = new Int32Array(new SharedArrayBuffer(4));
    const { port1, port2 } = new MessageChannel();
    this.port = port2;
    // $FlowFixMe
    const worker = new Worker(__dirname + '/worker.js', {
      workerData: {
        signal: this.signal,
        port: port1,
        options
      },
      transferList: [port1]
    });

    worker.unref();

    process.on('beforeExit', () => {
      worker.ref();
      this.port.postMessage({end: true});
    });
  }

  _send(message: any): any {
    this.signal[0] = 0;
    this.port.postMessage(message);
    Atomics.wait(this.signal, 0, 0);
    let {result, error} = receiveMessageOnPort(this.port).message;
    if (error) {
      error.codeFrame = error.codeframe;
      throw error;
    }

    return result;
  }

  transform(filePath: FilePath, code?: string): {|code: string|} {
    return this._send({transform: {filePath, code}});
  }

  resolve(moduleSpecifier: string, resolveFrom: ?FilePath): FilePath {
    return this._send({resolve: {moduleSpecifier, resolveFrom}})
  }
}
