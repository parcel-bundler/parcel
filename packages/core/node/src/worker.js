// @flow
import Parcel from '@parcel/core';
import {parentPort, workerData} from 'worker_threads';
import {anyToDiagnostic} from '@parcel/diagnostic';
import {prettyDiagnostic} from '@parcel/utils';
import {NodeFS} from '@parcel/fs';

let {signal, port, options} = workerData;
let parcel = new Parcel(options);

port.on('message', async (msg) => {
  if (msg.transform) {
    try {
      let {filePath, code} = msg.transform;
      let res = await parcel.transform({
        filePath,
        code,
        env: {
          context: 'node',
          engines: {
            node: process.versions.node,
          },
          shouldScopeHoist: false
        }
      });

      let output = '';
      if (res.length >= 1) {
        let asset = res.find(a => a.type === 'js');
        if (asset) {
          output = await asset.getCode();
        }
      }

      port.postMessage({result: {code: output}});
    } catch (err) {
      port.postMessage({error: await prettyDiagnostic(anyToDiagnostic(err)[0], {
        projectRoot: '/',
        inputFS: new NodeFS()
      })});
    }
  } else if (msg.resolve) {
    try {
      let {moduleSpecifier, resolveFrom} = msg.resolve;
      let res = await parcel.resolve({
        moduleSpecifier,
        resolveFrom,
        env: {
          context: 'node',
          engines: {
            node: process.versions.node,
          },
          shouldScopeHoist: false
        }
      });

      port.postMessage({result: res?.filePath});
    } catch (err) {
      port.postMessage({error: anyToDiagnostic(err)});
    }
  } else if (msg.end) {
    await parcel._end();
    process.exit();
  }

  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
}); 
