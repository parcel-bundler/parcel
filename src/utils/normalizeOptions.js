const Path = require('path');

const getRootDir = require('./getRootDir');

const getBool = (value, fallback) =>
  typeof value === 'boolean' ? value : fallback;

function normalizeOptions(options = {}, entryFiles = []) {
  const isProduction =
    options.production || process.env.NODE_ENV === 'production';

  const watch = getBool(options.watch, !isProduction);

  const target = options.target || 'browser';

  return {
    production: isProduction,
    outDir: Path.resolve(options.outDir || 'dist'),
    outFile: options.outFile || '',
    publicURL: options.publicUrl || options.publicURL || '/',
    watch: watch,
    cache: getBool(options.cache, true),
    cacheDir: Path.resolve(options.cacheDir || '.cache'),
    killWorkers: getBool(options.killWorkers, true),
    minify: getBool(options.minify, isProduction),
    target: target,
    bundleNodeModules: getBool(options.bundleNodeModules, target === 'browser'),
    hmr: target !== 'node' && getBool(options.hmr, watch),
    https: options.https || false,
    logLevel: isNaN(options.logLevel) ? 3 : options.logLevel,
    entryFiles: entryFiles,
    hmrPort: options.hmrPort || 0,
    rootDir: getRootDir(entryFiles),
    sourceMaps: getBool(options.sourceMaps, true) && !options.scopeHoist,
    hmrHostname:
      options.hmrHostname || (options.target === 'electron' ? 'localhost' : ''),
    detailedReport: options.detailedReport || false,
    global: options.global,
    autoinstall: getBool(options.autoinstall, !isProduction),
    scopeHoist: options.scopeHoist || false,
    contentHash: getBool(options.contentHash, isProduction)
  };
}

module.exports = normalizeOptions;
