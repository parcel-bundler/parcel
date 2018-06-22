const Path = require('path');
const getRootDir = require('./getRootDir');

function normalizeOptions(options = {}, entryFiles = []) {
  const {
    production: isProduction = process.env.NODE_ENV === 'production',
    publicURL = options.publicUrl || options.publicURL || '/',
    watch = !isProduction,
    target: buildTarget = 'browser',
    hmr = !isProduction,
    hmrHostname = buildTarget === 'electron' ? 'localhost' : '',
    scopeHoist = false,
    outDir = 'dist',
    outFile = '',
    cacheDir = '.cache',
    cache = true,
    logLevel = 3,
    https = false,
    killWorkers = true,
    minify = isProduction,
    hmrPort = 0,
    sourceMaps = true,
    detailedReport = false,
    global,
    autoinstall = !isProduction,
    contentHash = isProduction
  } = options;

  return {
    production: isProduction,
    outDir: Path.resolve(outDir),
    outFile,
    publicURL,
    watch,
    cache,
    cacheDir: Path.resolve(cacheDir),
    killWorkers,
    minify,
    target: buildTarget,
    hmr: buildTarget === 'node' ? false : hmr,
    hmrPort,
    hmrHostname,
    https,
    logLevel,
    entryFiles,
    rootDir: getRootDir(entryFiles),
    sourceMaps: sourceMaps && !scopeHoist,
    detailedReport,
    global,
    autoinstall,
    scopeHoist,
    contentHash
  };
}

module.exports = normalizeOptions;
