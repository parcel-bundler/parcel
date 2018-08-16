// @flow
'use strict';

const Orchestrator = require('../src/Orchestrator');
const assert = require('assert');

const config = require('@parcel/config-default');

describe('Orchestrator', () => {
  it('should work', async () => {
    let orchestrator = new Orchestrator(config, {});
    await orchestrator.run(__dirname, ['./fixtures/bundle.js']);
  });
});
