// @flow strict-local

import assert from 'assert';
import {createEnvironment} from '../src/Environment';

describe('Environment', () => {
  it('assigns a default environment with nothing passed', () => {
    assert.deepEqual(createEnvironment(), {
      context: 'browser',
      engines: {
        browsers: ['> 0.25%'],
      },
      excludeNodeModules: false,
      outputFormat: 'global',
      isLibrary: false,
      minify: false,
      scopeHoist: false,
    });
  });

  it('assigns a node context if a node engine is given', () => {
    assert.deepEqual(createEnvironment({engines: {node: '>= 10.0.0'}}), {
      context: 'node',
      engines: {
        node: '>= 10.0.0',
      },
      excludeNodeModules: true,
      outputFormat: 'commonjs',
      isLibrary: false,
      minify: false,
      scopeHoist: false,
    });
  });

  it('assigns a browser context if browser engines are given', () => {
    assert.deepEqual(
      createEnvironment({engines: {browsers: ['last 1 version']}}),
      {
        context: 'browser',
        engines: {
          browsers: ['last 1 version'],
        },
        excludeNodeModules: false,
        outputFormat: 'global',
        isLibrary: false,
        minify: false,
        scopeHoist: false,
      },
    );
  });

  it('assigns default engines for node', () => {
    assert.deepEqual(createEnvironment({context: 'node'}), {
      context: 'node',
      engines: {
        node: '>= 8.0.0',
      },
      excludeNodeModules: true,
      outputFormat: 'commonjs',
      isLibrary: false,
      minify: false,
      scopeHoist: false,
    });
  });

  it('assigns default engines for browsers', () => {
    assert.deepEqual(createEnvironment({context: 'browser'}), {
      context: 'browser',
      engines: {
        browsers: ['> 0.25%'],
      },
      excludeNodeModules: false,
      outputFormat: 'global',
      isLibrary: false,
      minify: false,
      scopeHoist: false,
    });
  });
});
