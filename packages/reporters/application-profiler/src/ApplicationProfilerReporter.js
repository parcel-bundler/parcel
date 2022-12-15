// @flow
import invariant from 'assert';
import nullthrows from 'nullthrows';
import {Reporter} from '@parcel/plugin';
import {Tracer} from 'chrome-trace-event';

// We need to maintain some state here to ensure we write to the same output, there should only be one
// instance of this reporter (this gets asserted below)
let tracer;
let writeStream = null;

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
        invariant(
          tracer == null,
          'Application profiler tracer multiple initialisation',
        );
        tracer = new Tracer();
        filename = `parcel-application-profile-${getTimeId()}.json`;
        invariant(
          writeStream == null,
          'Application profile write stream multiple initialisation',
        );
        logger.info({message: `Writing application profile to ${filename}`});
        writeStream = options.outputFS.createWriteStream(filename);
        nullthrows(tracer).pipe(nullthrows(writeStream));
        break;
      case 'trace':
        invariant(
          tracer instanceof Tracer,
          'Trace event received without Tracer instantiation',
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
        nullthrows(tracer).flush();
        // We explicitly trigger `end` on the writeStream for the trace, then we need to wait for
        // the `close` event before resolving the promise this report function returns to ensure
        // that the file has been properly closed and moved from it's temp location before Parcel
        // shuts down.
        return new Promise((resolve, reject) => {
          nullthrows(writeStream).once('close', err => {
            writeStream = null;
            tracer = null;
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
          nullthrows(writeStream).end();
        });
    }
  },
}): Reporter);
