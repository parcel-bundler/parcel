// @flow strict-local

import assert from 'assert';
import {createEnvironment} from '../src/Environment';

describe('Environment', () => {
  it('assigns a default environment with nothing passed', () => {
    assert.deepEqual(createEnvironment(), {
      id: 'c83ca9b24017e1e3f48f001f92aa51da',
      context: 'browser',
      engines: {
        browsers: ['> 0.25%'],
      },
      includeNodeModules: true,
      outputFormat: 'global',
      isLibrary: false,
      shouldOptimize: false,
      shouldScopeHoist: false,
      sourceMap: undefined,
      loc: undefined,
      sourceType: 'module',
    });
  });

  it('assigns a node context if a node engine is given', () => {
    assert.deepEqual(createEnvironment({engines: {node: '>= 10.0.0'}}), {
      id: '8c981a8961473a58b919c03741721e25',
      context: 'node',
      engines: {
        node: '>= 10.0.0',
      },
      includeNodeModules: false,
      outputFormat: 'commonjs',
      isLibrary: false,
      shouldOptimize: false,
      shouldScopeHoist: false,
      sourceMap: undefined,
      loc: undefined,
      sourceType: 'module',
    });
  });

  it('assigns a browser context if browser engines are given', () => {
    assert.deepEqual(
      createEnvironment({engines: {browsers: ['last 1 version']}}),
      {
        id: 'a72c48fdadd2d4c47a3eec71eab4eb36',
        context: 'browser',
        engines: {
          browsers: ['last 1 version'],
        },
        includeNodeModules: true,
        outputFormat: 'global',
        isLibrary: false,
        shouldOptimize: false,
        shouldScopeHoist: false,
        sourceMap: undefined,
        loc: undefined,
        sourceType: 'module',
      },
    );
  });

  it('assigns default engines for node', () => {
    assert.deepEqual(createEnvironment({context: 'node'}), {
      id: 'fbd532586d9a5c69405252416c600aa0',
      context: 'node',
      engines: {
        node: '>= 8.0.0',
      },
      includeNodeModules: false,
      outputFormat: 'commonjs',
      isLibrary: false,
      shouldOptimize: false,
      shouldScopeHoist: false,
      sourceMap: undefined,
      loc: undefined,
      sourceType: 'module',
    });
  });

  it('assigns default engines for browsers', () => {
    assert.deepEqual(createEnvironment({context: 'browser'}), {
      id: 'c83ca9b24017e1e3f48f001f92aa51da',
      context: 'browser',
      engines: {
        browsers: ['> 0.25%'],
      },
      includeNodeModules: true,
      outputFormat: 'global',
      isLibrary: false,
      shouldOptimize: false,
      shouldScopeHoist: false,
      sourceMap: undefined,
      loc: undefined,
      sourceType: 'module',
    });
  });
});
