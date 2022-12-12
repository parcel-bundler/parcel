// @flow
import invariant from 'assert';
import {Reporter} from '@parcel/plugin';
import {Tracer} from 'chrome-trace-event';

let tracer;

function millisecondsToMicroseconds(milliseconds: number) {
  return Math.floor(milliseconds * 1000);
}

// TODO: extract this to utils as it's also used in packages/core/workers/src/WorkerFarm.js
function getTimeId() {
  let now = new Date();
  return (
    String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')
  );
}

export default (new Reporter({
  report({event, options, logger}) {
    let filename;
    switch (event.type) {
      case 'buildStart':
        tracer = new Tracer();
        filename = `parcel-application-profile-${getTimeId()}.json`;
        logger.info({message: `Writing application profile to ${filename}`});
        tracer.pipe(options.outputFS.createWriteStream(filename));
        break;
      case 'trace':
        invariant(
          tracer instanceof Tracer,
          'Trace event received without Tracer instanciation',
        );
        tracer.completeEvent({
          name: event.name,
          cat: event.categories,
          args: event.args,
          ts: millisecondsToMicroseconds(event.ts),
          dur: millisecondsToMicroseconds(event.duration),
          tid: event.tid,
          pid: event.pid,
        });
        break;
      case 'buildSuccess':
      case 'buildFailure':
        tracer.flush();
        break;
    }
  },
}): Reporter);
