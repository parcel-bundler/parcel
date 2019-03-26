// @flow strict-local

import nullthrows from 'nullthrows';
import {Reporter} from '@parcel/plugin';
import {patchConsole} from '@parcel/logger';
import React from 'react';
import {render} from 'ink';
import UI from './UI';

// Misbehaved plugins or their dependencies can write to stdout, disrupting
// ink's output. Patch console.log and similar to route output through
// the main Parcel logger.
patchConsole();

let ui: ?UI;
render(<UI ref={u => (ui = u)} />);

export default new Reporter({
  report(event, options) {
    nullthrows(ui).report(event, options);
  }
});
