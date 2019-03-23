// @flow strict-local

import nullthrows from 'nullthrows';
import {PassThrough} from 'stream';
import {Reporter} from '@parcel/plugin';
import {patchConsole} from '@parcel/logger';
import React from 'react';
import {render, type StdoutLike} from 'ink';
import UI from './UI';

// Misbehaved plugins or their dependencies can write to stdout, disrupting
// ink's output. Patch console.log and similar to route output through
// the main Parcel logger.
patchConsole();

// Ink expects stdout (or whatever is passed as stdout) to have a columns properly.
// In environments like Lerna child processes, this property does not exist.
// Create our own proxy object with `columns` on it that falls back to something sensible.

// $FlowFixMe columns is added below
const stdoutProxy: StdoutLike = new PassThrough();
stdoutProxy.pipe(process.stdout);
stdoutProxy.columns =
  typeof process.stdout.columns === 'number' ? process.stdout.columns : 80;

let ui: ?UI;
render(<UI ref={u => (ui = u)} />, {
  stdout: stdoutProxy
});

export default new Reporter({
  report(event, options) {
    nullthrows(ui).report(event, options);
  }
});
