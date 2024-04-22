// @flow strict-local

import assert from 'assert';
import {createEnvironment} from '../src/Environment';

describe('Environment', () => {
  it('assigns a default environment with nothing passed', () => {
    assert.deepEqual(createEnvironment(), {
      id: '788187fcd358de46',
      context: 0,
      engines: {
        browsers: ['> 0.25%'],
      },
      includeNodeModules: true,
      outputFormat: 0,
      flags: 0,
      sourceMap: undefined,
      loc: undefined,
      sourceType: 0,
    });
  });

  it('assigns a node context if a node engine is given', () => {
    assert.deepEqual(createEnvironment({engines: {node: '>= 10.0.0'}}), {
      id: '2f10f79854f6b94b',
      context: 4,
      engines: {
        node: '>= 10.0.0',
      },
      includeNodeModules: false,
      outputFormat: 1,
      flags: 0,
      sourceMap: undefined,
      loc: undefined,
      sourceType: 0,
    });
  });

  it('assigns a browser context if browser engines are given', () => {
    assert.deepEqual(
      createEnvironment({engines: {browsers: ['last 1 version']}}),
      {
        id: '314954654e82feb3',
        context: 0,
        engines: {
          browsers: ['last 1 version'],
        },
        includeNodeModules: true,
        outputFormat: 0,
        flags: 0,
        sourceMap: undefined,
        loc: undefined,
        sourceType: 0,
      },
    );
  });

  it('assigns default engines for node', () => {
    assert.deepEqual(createEnvironment({context: 'node'}), {
      id: '81b1dde8607da1b5',
      context: 4,
      engines: {
        node: '>= 8.0.0',
      },
      includeNodeModules: false,
      outputFormat: 1,
      flags: 0,
      sourceMap: undefined,
      loc: undefined,
      sourceType: 0,
    });
  });

  it('assigns default engines for browsers', () => {
    assert.deepEqual(createEnvironment({context: 'browser'}), {
      id: '788187fcd358de46',
      context: 0,
      engines: {
        browsers: ['> 0.25%'],
      },
      includeNodeModules: true,
      outputFormat: 0,
      flags: 0,
      sourceMap: undefined,
      loc: undefined,
      sourceType: 0,
    });
  });
});
