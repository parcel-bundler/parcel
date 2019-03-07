// @flow

import assert from 'assert';
import shallowEqual from 'shallowequal';

import Asset from '../src/Asset';
import Environment from '../src/Environment';

const ast = {
  type: 'program',
  version: '1.0',
  program: {},
  isDirty: true
};

const DEFAULT_ENV = new Environment({
  context: 'browser',
  engines: {
    browsers: ['> 1%']
  }
});

function getDefaultOptions() {
  return {
    id: 'id',
    hash: 'hash',
    filePath: 'path/to/file',
    type: 'file',
    code: 'code',
    ast,
    dependencies: [],
    connectedFiles: [],
    output: {code: 'output'},
    outputSize: 25,
    outputHash: 'outputHash',
    env: DEFAULT_ENV,
    meta: {}
  };
}

describe('Asset', () => {
  it('assigns options to properties when provided', () => {
    let defaultOptions = getDefaultOptions();
    let asset = new Asset(defaultOptions);
    assert.equal(asset.id, defaultOptions.id);
    assert.equal(asset.hash, defaultOptions.hash);
    assert.equal(asset.filePath, defaultOptions.filePath);
    assert.equal(asset.type, defaultOptions.type);
    assert.equal(asset.code, defaultOptions.code);
    assert.equal(asset.ast, defaultOptions.ast);
    assert(shallowEqual(asset.dependencies, defaultOptions.dependencies));
    assert(shallowEqual(asset.connectedFiles, defaultOptions.connectedFiles));
    assert.equal(asset.output, defaultOptions.output);
    assert.equal(asset.outputSize, defaultOptions.outputSize);
    assert.equal(asset.outputHash, defaultOptions.outputHash);
    assert.equal(asset.env, defaultOptions.env);
    assert.equal(asset.meta, defaultOptions.meta);
  });

  it('derives an id by hashing filePath, type, and env', () => {
    let defaultOptionsWithoutId = getDefaultOptions();
    delete defaultOptionsWithoutId.id;

    let asset = new Asset(defaultOptionsWithoutId);
    assert.equal(asset.id, 'a17a7cc344d5d92002c0100fb3eb3fef');
  });

  it('derives code from options.output.code if options.code is not provided', () => {
    let defaultOptionsWithoutCode = getDefaultOptions();
    delete defaultOptionsWithoutCode.code;

    let asset = new Asset(defaultOptionsWithoutCode);
    assert.equal(asset.code, 'output');
  });

  it('has empty code if neither options.output.code nor options.code is provided', () => {
    let defaultOptionsWithoutCodeOrOutput = getDefaultOptions();
    delete defaultOptionsWithoutCodeOrOutput.code;
    delete defaultOptionsWithoutCodeOrOutput.output;

    let asset = new Asset(defaultOptionsWithoutCodeOrOutput);
    assert.equal(asset.code, '');
  });

  it('derives output from code if no output is provided', () => {
    let defaultOptionsWithoutOutput = getDefaultOptions();
    delete defaultOptionsWithoutOutput.output;

    let asset = new Asset(defaultOptionsWithoutOutput);
    assert.equal(asset.code, 'code');
  });

  it('derives output size from output code length if outputSize is not provided', () => {
    let defaultOptionsWithoutOutputSize = getDefaultOptions();
    delete defaultOptionsWithoutOutputSize.outputSize;

    let asset = new Asset(defaultOptionsWithoutOutputSize);
    assert.equal(asset.outputSize, 6);
  });
});
