// @flow strict-local

import nullthrows from 'nullthrows';
import {Reporter} from '@parcel/plugin';
import React from 'react';
import {render} from 'ink';
import UI from './UI';

let ui: ?UI;

export default new Reporter({
  report(event, options) {
    if (!ui) {
      render(<UI options={options} ref={u => (ui = u)} />);
    }

    nullthrows(ui).report(event, options);
  }
});
