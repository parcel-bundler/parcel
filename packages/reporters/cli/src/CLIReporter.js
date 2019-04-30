// @flow strict-local

import nullthrows from 'nullthrows';
import {Reporter} from '@parcel/plugin';
import React from 'react';
import {render} from 'ink';
import UI from './UI';

let ui: ?UI;
render(<UI ref={u => (ui = u)} />);

export default new Reporter({
  report(event, options) {
    nullthrows(ui).report(event, options);
  }
});
