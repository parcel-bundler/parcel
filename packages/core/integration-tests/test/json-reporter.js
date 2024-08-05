// @flow

/* eslint-disable no-console */

import assert from 'assert';
import invariant from 'assert';
import path from 'path';
import {bundle, describe, it} from '@parcel/test-utils';
import sinon from 'sinon';

const config = path.join(
  __dirname,
  './integration/custom-configs/.parcelrc-json-reporter',
);

describe.v2('json reporter', () => {
  it('logs bundling a commonjs bundle to stdout as json', async () => {
    let consoleStub = sinon.stub(console, 'log');
    try {
      await bundle(path.join(__dirname, '/integration/commonjs/index.js'), {
        config,
        logLevel: 'info',
      });

      let parsedCalls = consoleStub.getCalls().map(call => {
        invariant(typeof call.lastArg === 'string');
        return JSON.parse(call.lastArg);
      });
      for (let [iStr, parsed] of Object.entries(parsedCalls)) {
        parsed = (parsed: any);
        invariant(typeof iStr === 'string');
        let i = parseInt(iStr, 10);

        if (i === 0) {
          assert.deepEqual(parsed, {type: 'buildStart'});
        } else if (i > 0 && i < 9) {
          assert.equal(parsed.type, 'buildProgress');
          assert.equal(parsed.phase, 'transforming');
          assert(typeof parsed.filePath === 'string');
        } else if (i === 9) {
          assert.deepEqual(parsed, {
            type: 'buildProgress',
            phase: 'bundling',
          });
        } else if (i === 10) {
          assert.equal(parsed.type, 'buildProgress');
          assert.equal(parsed.phase, 'packaging');
          assert.equal(parsed.bundleName, 'index.js');
        } else if (i === 11) {
          assert.equal(parsed.type, 'buildProgress');
          assert.equal(parsed.phase, 'optimizing');
          assert.equal(parsed.bundleName, 'index.js');
        } else if (i === 12) {
          assert.equal(parsed.type, 'buildSuccess');
          assert(typeof parsed.buildTime === 'number');
          assert(Array.isArray(parsed.bundles));
          let bundle = parsed.bundles[0];
          assert.equal(path.basename(bundle.filePath), 'index.js');
          assert(typeof bundle.size === 'number');
          assert(typeof bundle.time === 'number');
          assert(Array.isArray(bundle.assets));
        }
      }
    } finally {
      consoleStub.restore();
    }
  });
});
