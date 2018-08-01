const Path = require('path');
const assert = require('assert');
const normalizeOptions = require('../src/utils/normalizeOptions');

const expectedDefaultOptions = Object.freeze({
  production: false,
  outDir: Path.resolve('dist'),
  outFile: '',
  publicURL: '/',
  watch: true,
  cache: true,
  cacheDir: Path.resolve('.cache'),
  killWorkers: true,
  minify: false,
  target: 'browser',
  hmr: true,
  https: false,
  logLevel: 3,
  entryFiles: [],
  hmrPort: 0,
  rootDir: Path.resolve(''),
  sourceMaps: true,
  hmrHostname: '',
  detailedReport: false,
  global: undefined,
  autoinstall: true,
  scopeHoist: false,
  contentHash: false,
  bundleNodeModules: true
});

describe('normalizeOptions', () => {
  it('should return the right default options', () => {
    assert.deepEqual(normalizeOptions(), expectedDefaultOptions);
  });

  it('should change other options if production = true', () => {
    assert.deepEqual(
      normalizeOptions({production: true}),
      Object.assign({}, expectedDefaultOptions, {
        production: true,
        watch: false,
        hmr: false,
        minify: true,
        contentHash: true,
        autoinstall: false
      })
    );
  });

  it('should set watch to false', () => {
    assert.deepEqual(
      normalizeOptions({watch: false}),
      Object.assign({}, expectedDefaultOptions, {
        watch: false,
        hmr: false
      })
    );
  });

  it('should set sourceMaps to off if scopeHoist === true', () => {
    assert.deepEqual(
      normalizeOptions({scopeHoist: true}),
      Object.assign({}, expectedDefaultOptions, {
        sourceMaps: false,
        scopeHoist: true
      })
    );
  });

  it('should set hmr to false if target === node', () => {
    assert.deepEqual(
      normalizeOptions({target: 'node'}),
      Object.assign({}, expectedDefaultOptions, {
        target: 'node',
        bundleNodeModules: false,
        hmr: false
      })
    );
  });

  it('should set hmrHostname to localhost if target === electron', () => {
    assert.deepEqual(
      normalizeOptions({target: 'electron'}),
      Object.assign({}, expectedDefaultOptions, {
        target: 'electron',
        bundleNodeModules: false,
        hmrHostname: 'localhost'
      })
    );
  });

  it('should set bundleNodeModules to true if target === browser', () => {
    assert.deepEqual(
      normalizeOptions({target: 'dummy'}),
      Object.assign({}, expectedDefaultOptions, {
        bundleNodeModules: false,
        target: 'dummy'
      })
    );

    assert.deepEqual(
      normalizeOptions({target: 'browser'}),
      Object.assign({}, expectedDefaultOptions, {
        bundleNodeModules: true
      })
    );
  });

  it('should set bundleNodeModules ', () => {
    assert.deepEqual(
      normalizeOptions({bundleNodeModules: true}),
      Object.assign({}, expectedDefaultOptions, {
        bundleNodeModules: true
      })
    );

    assert.deepEqual(
      normalizeOptions({bundleNodeModules: false}),
      Object.assign({}, expectedDefaultOptions, {
        bundleNodeModules: false
      })
    );
  });
});
