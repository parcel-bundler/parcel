// @flow
import {ParcelNode} from '@parcel/node';

// import {Worker, MessagePort} from 'worker_threads';
// import path from 'path';

// export const signal = new Int32Array(new SharedArrayBuffer(4));
// const { port1, port2 } = new MessageChannel();
// const worker = new Worker(__dirname + '/worker.js', {
//   workerData: {
//     signal,
//     port: port1
//   },
//   transferList: [port1]
// });

// worker.unref();

// export { port2 as port };

export const parcel = (new ParcelNode({
  defaultConfig: require.resolve('@parcel/config-default'),
}): ParcelNode);
