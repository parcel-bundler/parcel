// @flow
'use strict';

const Orchestrator = require('../src/Orchestrator');
const assert = require('assert');

describe('Orchestrator', () => {
  it('should work', async () => {
    let orchestrator = new Orchestrator();
    await orchestrator.run(process.cwd(), []);
  });
});
