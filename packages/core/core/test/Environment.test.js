// @flow strict-local

import assert from 'assert';
import {createEnvironment} from '../src/Environment';

describe('Environment', () => {
  it('assigns a default environment with nothing passed', () => {
    assert.deepEqual(createEnvironment(), {
      id: '86d7d73792af2fa2046abf3c2ab55aa8',
      context: 'browser',
      engines: {
        browsers: ['> 0.25%'],
      },
      includeNodeModules: true,
      outputFormat: 'global',
      isLibrary: false,
      minify: false,
      scopeHoist: false,
      sourceMap: undefined,
    });
  });

  it('assigns a node context if a node engine is given', () => {
    assert.deepEqual(createEnvironment({engines: {node: '>= 10.0.0'}}), {
      id: '33b63a51b1b17ee79ab504c2a5a564e9',
      context: 'node',
      engines: {
        node: '>= 10.0.0',
      },
      includeNodeModules: false,
      outputFormat: 'commonjs',
      isLibrary: false,
      minify: false,
      scopeHoist: false,
      sourceMap: undefined,
    });
  });

  it('assigns a browser context if browser engines are given', () => {
    assert.deepEqual(
      createEnvironment({engines: {browsers: ['last 1 version']}}),
      {
        id: 'd3665a7cc8b5db9caaffe0150e51f313',
        context: 'browser',
        engines: {
          browsers: ['last 1 version'],
        },
        includeNodeModules: true,
        outputFormat: 'global',
        isLibrary: false,
        minify: false,
        scopeHoist: false,
        sourceMap: undefined,
      },
    );
  });

  it('assigns default engines for node', () => {
    assert.deepEqual(createEnvironment({context: 'node'}), {
      id: '19ef13a8424764abaf7be15b77523770',
      context: 'node',
      engines: {
        node: '>= 8.0.0',
      },
      includeNodeModules: false,
      outputFormat: 'commonjs',
      isLibrary: false,
      minify: false,
      scopeHoist: false,
      sourceMap: undefined,
    });
  });

  it('assigns default engines for browsers', () => {
    assert.deepEqual(createEnvironment({context: 'browser'}), {
      id: '86d7d73792af2fa2046abf3c2ab55aa8',
      context: 'browser',
      engines: {
        browsers: ['> 0.25%'],
      },
      includeNodeModules: true,
      outputFormat: 'global',
      isLibrary: false,
      minify: false,
      scopeHoist: false,
      sourceMap: undefined,
    });
  });
});
