// @flow strict-local

import type {ReporterEvent} from '@parcel/types';

import {render} from 'ink';
import {Reporter} from '@parcel/plugin';
import React from 'react';
import {ValueEmitter} from '@parcel/events';

import UI from './UI';

let rendered = false;
let events = new ValueEmitter<ReporterEvent>();

export default new Reporter({
  report({event, options}) {
    if (!rendered) {
      render(<UI options={options} events={events} />);
      rendered = true;
    }

    events.emit(event);
  }
});
