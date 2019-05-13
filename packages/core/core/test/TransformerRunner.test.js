// @flow
import TransformerRunner from '../src/TransformerRunner';
import Config from '../src/Config';
import Environment from '../src/Environment';

const config = require('@parcel/config-default');

const EMPTY_OPTIONS = {
  cacheDir: '.parcel-cache',
  entries: [],
  logLevel: 'none',
  rootDir: __dirname,
  targets: []
};

const runner = new TransformerRunner({
  config: new Config({
    ...config,
    filePath: require.resolve('@parcel/config-default')
  }),
  options: EMPTY_OPTIONS
});

const DEFAULT_ENV = new Environment({
  context: 'browser',
  engines: {
    browsers: ['> 1%']
  }
});

describe.skip('TransformerRunner', function() {
  it('should transform some shit', async function() {
    let dummyAsset = {
      filePath: __dirname + '/fixtures/module-a.js',
      env: DEFAULT_ENV
    };

    let result = await runner.transform(dummyAsset);
    console.log(JSON.stringify(result, null, 2)); // eslint-disable-line no-console
  });

  it.skip('should transform some shitty typescript', async function() {
    let dummyAsset = {
      filePath: __dirname + '/fixtures/module-a.ts',
      env: DEFAULT_ENV
    };

    let result = await runner.transform(dummyAsset);
    console.log(result); // eslint-disable-line no-console
  });
});
