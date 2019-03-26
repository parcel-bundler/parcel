// @flow strict-local

import type {FilePath} from '@parcel/types';

import {errorToJson, type JSONError} from '@parcel/utils/src/errorUtils';
import {FSWatcher} from 'chokidar';
import invariant from 'assert';

import {decodeOptions, type EncodedFSWatcherOptions} from './options';

let watcher;
function sendEvent(event: string, path?: FilePath | JSONError) {
  if (
    event !== 'ready' &&
    event !== 'raw' &&
    event !== 'error' &&
    event !== '_chokidarReady'
  ) {
    invariant(
      process.send({
        event: 'all',
        data: {action: event, path}
      }) != null
    );
  }

  process.send({
    event: event,
    data: path
  });
}

function handleError(e: Error) {
  sendEvent('watcherError', errorToJson(e));
}

function init(options: EncodedFSWatcherOptions) {
  let decodedOptions = decodeOptions(options);
  watcher = new FSWatcher(decodedOptions);
  watcher.on('all', sendEvent);
  sendEvent('ready');

  // only used for testing
  watcher.once('ready', async () => {
    // Wait an additional macrotask. This seems to be necessary before changes
    // can be picked up.
    await new Promise(resolve => setImmediate(resolve));
    sendEvent('_chokidarReady');
  });
}

function executeFunction(functionName, args) {
  try {
    // $FlowFixMe this must be dynamic
    watcher[functionName](...args);
  } catch (e) {
    handleError(e);
  }
}

process.on('message', msg => {
  switch (msg.type) {
    case 'init':
      init(msg.options);
      break;
    case 'function':
      executeFunction(msg.name, msg.args);
      break;
    case 'die':
      process.exit();
      break;
    case 'emulate_error':
      throw new Error('this is an emulated error');
  }
});

process.on('error', handleError);
process.on('uncaughtException', handleError);
process.on('disconnect', () => {
  process.exit();
});
