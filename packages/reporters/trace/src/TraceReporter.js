// @flow strict-local

import {Reporter} from '@parcel/plugin';
import fs from 'fs';
import {Tracer} from 'chrome-trace-event';

const tracer = new Tracer();
tracer.pipe(fs.createWriteStream('parcel-trace.json'));

export default (new Reporter({
  report({event}) {
    switch (event.type) {
      case 'trace': {
        tracer.completeEvent({
          name: event.name,
          ts: millisecondsToMicroseconds(event.ts),
          dur: millisecondsToMicroseconds(event.duration),
          tid: event.tid,
          pid: event.pid,
        });
        break;
      }
      case 'buildSuccess':
      case 'buildFailure':
        tracer.flush();
    }
  },
}): Reporter);

function millisecondsToMicroseconds(milliseconds: number) {
  return Math.floor(milliseconds * 1000);
}
