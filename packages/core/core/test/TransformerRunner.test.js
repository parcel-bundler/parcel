// @flow
'use strict';
import assert from 'assert';

import TransformerRunner from '../src/TransformerRunner';
import Config from '../src/Config';

const config = require('@parcel/config-default');
const runner = new TransformerRunner({
  config: new Config(config, require.resolve('@parcel/config-default')),
  cliOpts: {}
});

const DEFAULT_ENV = {
  context: 'browser',
  engines: {
    browsers: ['> 1%']
  }
};

describe('TransformerRunner', function() {
  it('should transform some shit', async function() {
    let dummyAsset = {
      filePath: __dirname + '/fixtures/module-a.js',
      env: DEFAULT_ENV
    };

    let result = await runner.transform(dummyAsset);
    console.log(JSON.stringify(result, null, 2));
  });

  it.skip('should transform some shitty typescript', async function() {
    let dummyAsset = {
      filePath: __dirname + '/fixtures/module-a.ts',
      env: DEFAULT_ENV
    };

    let result = await runner.transform(dummyAsset);
    console.log(result);
  });
});
