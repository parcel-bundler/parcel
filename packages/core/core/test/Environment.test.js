// @flow strict-local

import assert from 'assert';
import Environment from '../src/Environment';

describe('Environment', () => {
  it('assigns a default environment with nothing passed', () => {
    assert.deepEqual(new Environment(), {
      context: 'browser',
      engines: {
        browsers: ['> 0.25%']
      },
      includeNodeModules: true
    });
  });

  it('assigns a node context if a node engine is given', () => {
    assert.deepEqual(new Environment({engines: {node: '>= 10.0.0'}}), {
      context: 'node',
      engines: {
        node: '>= 10.0.0'
      },
      includeNodeModules: false
    });
  });

  it('assigns a browser context if browser engines are given', () => {
    assert.deepEqual(
      new Environment({engines: {browsers: ['last 1 version']}}),
      {
        context: 'browser',
        engines: {
          browsers: ['last 1 version']
        },
        includeNodeModules: true
      }
    );
  });

  it('assigns default engines for node', () => {
    assert.deepEqual(new Environment({context: 'node'}), {
      context: 'node',
      engines: {
        node: '>= 8.0.0'
      },
      includeNodeModules: false
    });
  });

  it('assigns default engines for browsers', () => {
    assert.deepEqual(new Environment({context: 'browser'}), {
      context: 'browser',
      engines: {
        browsers: ['> 0.25%']
      },
      includeNodeModules: true
    });
  });
});
