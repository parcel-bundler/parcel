const path = require('path');
const prettifyTime = require('./prettifyTime');
const logger = require('../Logger');
const emoji = require('./emoji');
const filesize = require('filesize');

const LARGE_BUNDLE_SIZE = 1024 * 1024;
const NUM_LARGE_ASSETS = 10;
const COLUMNS = [
  {align: 'left'}, // name
  {align: 'right'}, // size
  {align: 'right'} // time
];

function bundleReport(mainBundle, detailed = false) {
  // Get a list of bundles sorted by size
  let bundles = Array.from(iterateBundles(mainBundle)).sort(
    (a, b) => b.totalSize - a.totalSize
  );
  let rows = [];

  for (let bundle of bundles) {
    // Add a row for the bundle
    rows.push([
      formatFilename(bundle.name, logger.chalk.cyan.bold),
      logger.chalk.bold(
        prettifySize(bundle.totalSize, bundle.totalSize > LARGE_BUNDLE_SIZE)
      ),
      logger.chalk.green.bold(prettifyTime(bundle.bundleTime))
    ]);

    // If detailed, generate a list of the top 10 largest assets in the bundle
    if (detailed && bundle.assets.size > 1) {
      let assets = Array.from(bundle.assets)
        .filter(a => a.type === bundle.type)
        .sort((a, b) => b.bundledSize - a.bundledSize);

      let largestAssets = assets.slice(0, NUM_LARGE_ASSETS);
      for (let asset of largestAssets) {
        // Add a row for the asset.
        rows.push([
          (asset == assets[assets.length - 1] ? '└── ' : '├── ') +
            formatFilename(asset.name, logger.chalk.reset),
          logger.chalk.dim(prettifySize(asset.bundledSize)),
          logger.chalk.dim(logger.chalk.green(prettifyTime(asset.buildTime)))
        ]);
      }

      // Show how many more assets there are
      if (assets.length > largestAssets.length) {
        rows.push([
          '└── ' +
            logger.chalk.dim(
              `+ ${assets.length - largestAssets.length} more assets`
            )
        ]);
      }

      // If this isn't the last bundle, add an empty row before the next one
      if (bundle !== bundles[bundles.length - 1]) {
        rows.push([]);
      }
    }
  }

  // Render table
  logger.log('');
  logger.table(COLUMNS, rows);
}

module.exports = bundleReport;

function* iterateBundles(bundle) {
  if (!bundle.isEmpty) {
    yield bundle;
  }

  for (let child of bundle.childBundles) {
    yield* iterateBundles(child);
  }
}

function prettifySize(size, isLarge) {
  let res = filesize(size);
  if (isLarge) {
    return logger.chalk.yellow(emoji.warning + '  ' + res);
  }
  return logger.chalk.magenta(res);
}

function formatFilename(filename, color = logger.chalk.reset) {
  let dir = path.relative(process.cwd(), path.dirname(filename));
  return (
    logger.chalk.dim(dir + (dir ? path.sep : '')) +
    color(path.basename(filename))
  );
}
