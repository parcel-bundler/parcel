const path = require('path');
const prettifyTime = require('./prettifyTime');
const logger = require('../Logger');
const emoji = require('./emoji');
const filesize = require('filesize');

const sizeTypes = ['B', 'kB', 'MB', 'GB'];

function padEnd(text, length, character = ' ') {
  // Babel doesn't catch String.prototype.padEnd as being Node 8+
  return text + character.repeat(Math.round(length - text.length));
}

function writeRow(columnWidth, items) {
  let res = '';
  if (Array.isArray(items)) {
    for (let i = 0; i < items.length; i++) {
      let item = items[i];
      let itemWidth = Array.isArray(columnWidth) ? columnWidth[i] : columnWidth;
      item =
        item.length + 1 > itemWidth
          ? path.basename(item).substring(0, itemWidth)
          : item;
      res += padEnd(item, itemWidth);
    }
  }
  return res;
}

function prettifySize(size, largeSize) {
  let isLarge = size > largeSize;
  let res = filesize(size);
  if (isLarge) {
    res = logger.chalk.yellow(emoji.warning + '  ' + res);
  } else {
    res = logger.chalk.magenta(res);
  }

  return res;
}

function createBundlesArray(mainBundle) {
  let bundles = [mainBundle];
  for (let bundle of mainBundle.childBundles) {
    bundles = bundles.concat(createBundlesArray(bundle));
  }
  bundles.sort((a, b) => b.totalSize - a.totalSize);
  return bundles;
}

function getLargestBundleName(bundles) {
  let size = 0;
  for (let bundle of bundles) {
    let basename = path.basename(bundle.name);
    if (basename.length > size) {
      size = basename.length;
    }
  }
  return size;
}

function formatFilename(filename, color = logger.chalk.reset) {
  let dir = path.relative(process.cwd(), path.dirname(filename));
  return logger.chalk.dim(dir + (dir ? path.sep : '')) + color(path.basename(filename));
}

function bundleReport(mainBundle, detailed = false) {
  let report = 'Bundles created:\n';
  const bundles = createBundlesArray(mainBundle);
  let nameSize = getLargestBundleName(bundles);
  const columnWidths = [nameSize + 5, 12, 12];
  report += writeRow(columnWidths, ['Name', 'Size', 'Time']) + '\n';
  let totalSize = 0;
  let totalTime = 0;
  let rows = [];
  for (let bundle of bundles) {
    totalSize += bundle.totalSize;
    totalTime += bundle.bundleTime;
    rows.push([
      formatFilename(bundle.name, logger.chalk.cyan.bold),
      logger.chalk.bold(prettifySize(bundle.totalSize, 1024 * 1024)),
      logger.chalk.green.bold(prettifyTime(bundle.bundleTime))
    ]);

    if (detailed && bundle.assets.size > 1) {
      let assets = Array.from(bundle.assets).filter(a => a.type === bundle.type).sort((a, b) => b.bundledSize - a.bundledSize);
      let modules = {};
      let duplicates = new Set;
      for (let asset of assets) {
        if (asset.bundledSize && asset.package && asset.package.name) {
          if (modules[asset.package.name] && modules[asset.package.name].some(a => a.package.version !== asset.package.version)) {
            for (let a of modules[asset.package.name]) {
              duplicates.add(a);
            }
            duplicates.add(asset);
          }

          if (!modules[asset.package.name]) {
            modules[asset.package.name] = [];
          }
          modules[asset.package.name].push(asset);
        }
      }

      let largestAssets = assets.slice(0, 10);
      // for (let asset of duplicates) {
      //   if (asset.bundledSize) {
      //     largestAssets.add(asset);
      //   }
      // }

      for (let asset of largestAssets) {
        let filename = asset.name;
        // if (duplicates.has(asset)) {
        //   filename = filename.replace('node_modules' + path.sep + asset.package.name, 'node_modules' + path.sep + logger.chalk.reset.red.bold(asset.package.name));
        //   // filename += ' 🚨';
        // }

        rows.push([
          (asset == assets[assets.length - 1] ? '└' : '├') + '── ' + formatFilename(filename, logger.chalk.reset),
          logger.chalk.dim(prettifySize(asset.bundledSize)),
          logger.chalk.dim(logger.chalk.green(prettifyTime(asset.buildTime)))
        ]);
      }

      if (assets.length > largestAssets.length) {
        rows.push(['└── ' + logger.chalk.dim(`+ ${assets.length - largestAssets.length} more assets`)]);
      }

      if (bundle !== bundles[bundles.length - 1]) {
        rows.push([]);
      }
    }
  }

  logger.log('');
  logger.table([{name: 'Bundle'}, {name: 'Size', align: 'right'}, {name: 'Time', align: 'right'}], rows);
  // logger.log('\n');
  return report;
}

module.exports = bundleReport;
