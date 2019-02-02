// @flow
import {Reporter} from '@parcel/plugin';
import React from 'react';
import {render} from 'ink';
import UI from './UI';

let ui: UI;
// $FlowFixMe
render(<UI ref={u => (ui = u)} />);

export default new Reporter({
  report(event, options) {
    ui.report(event, options);
  }
});
