const path = require('path');
const prettifyTime = require('./prettifyTime');
const sizeTypes = ['B', 'KiB', 'MiB', 'GiB'];

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

function prettifySize(size) {
  let type = 0;
  while (size > 1024 && type < sizeTypes.length - 1) {
    size = size / 1024;
    type++;
  }
  return `${type > 0 ? size.toFixed(2) : size} ${sizeTypes[type]}`;
}

function createBundlesArray(mainBundle) {
  let bundles = [mainBundle];
  for (let bundle of mainBundle.childBundles) {
    bundles = bundles.concat(createBundlesArray(bundle));
  }
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

function bundleReport(mainBundle, detailed = false) {
  let report = 'Bundles created:\n';
  const bundles = createBundlesArray(mainBundle);
  let nameSize = getLargestBundleName(bundles);
  const columnWidths = [nameSize + 5, 12, 12];
  report += writeRow(columnWidths, ['Name', 'Size', 'Time']) + '\n';
  let totalSize = 0;
  let totalTime = 0;
  for (let bundle of bundles) {
    totalSize += bundle.totalSize;
    totalTime += bundle.bundleTime;
    report +=
      writeRow(columnWidths, [
        path.basename(bundle.name),
        prettifySize(bundle.totalSize),
        prettifyTime(bundle.bundleTime)
      ]) + '\n';
    if (detailed) {
      const assetColumnWidths = [...columnWidths];
      assetColumnWidths[0] = assetColumnWidths[0] - 2;
      for (let asset of bundle.assets) {
        report +=
          '--' +
          writeRow(assetColumnWidths, [
            asset.relativeName,
            prettifySize(asset.bundledSize),
            prettifyTime(asset.buildTime)
          ]) +
          '\n';
      }
    }
  }
  report += '\n';
  report += writeRow(columnWidths, [
    'Totals: ',
    prettifySize(totalSize),
    prettifyTime(totalTime)
  ]);
  return report;
}

module.exports = bundleReport;
