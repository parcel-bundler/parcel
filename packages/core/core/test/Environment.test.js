// @flow strict-local

import assert from 'assert';
import {createEnvironment} from '../src/Environment';
import {DB, getEnv} from './test-utils';

describe('Environment', () => {
  it('assigns a default environment with nothing passed', () => {
    assert.deepEqual(getEnv(createEnvironment(DB)), {
      context: 'browser',
      engines: {
        browsers: ['> 0.25%'],
      },
      includeNodeModules: true,
      isLibrary: false,
      loc: null,
      outputFormat: 'global',
      shouldScopeHoist: false,
      shouldOptimize: false,
      sourceMap: null,
      sourceType: 'module',
    });
  });

  it('assigns a node context if a node engine is given', () => {
    assert.deepEqual(
      getEnv(createEnvironment(DB, {engines: {node: '>= 10.0.0'}})),
      {
        context: 'node',
        engines: {
          node: '>= 10.0.0',
        },
        includeNodeModules: false,
        isLibrary: false,
        loc: null,
        outputFormat: 'commonjs',
        shouldScopeHoist: false,
        shouldOptimize: false,
        sourceMap: null,
        sourceType: 'module',
      },
    );
  });

  it('assigns a browser context if browser engines are given', () => {
    assert.deepEqual(
      getEnv(createEnvironment(DB, {engines: {browsers: ['last 1 version']}})),
      {
        context: 'browser',
        engines: {
          browsers: ['last 1 version'],
        },
        includeNodeModules: true,
        isLibrary: false,
        loc: null,
        outputFormat: 'global',
        shouldOptimize: false,
        shouldScopeHoist: false,
        sourceMap: null,
        sourceType: 'module',
      },
    );
  });

  it('assigns default engines for node', () => {
    assert.deepEqual(getEnv(createEnvironment(DB, {context: 'node'})), {
      context: 'node',
      engines: {
        node: '>= 8.0.0',
      },
      includeNodeModules: false,
      isLibrary: false,
      loc: null,
      outputFormat: 'commonjs',
      sourceMap: null,
      shouldOptimize: false,
      shouldScopeHoist: false,
      sourceType: 'module',
    });
  });

  it('assigns default engines for browsers', () => {
    assert.deepEqual(getEnv(createEnvironment(DB, {context: 'browser'})), {
      context: 'browser',
      engines: {
        browsers: ['> 0.25%'],
      },
      includeNodeModules: true,
      isLibrary: false,
      loc: null,
      outputFormat: 'global',
      shouldOptimize: false,
      shouldScopeHoist: false,
      sourceMap: null,
      sourceType: 'module',
    });
  });
});
