const path = require('path');
const sizeTypes = ['B', 'KB', 'MB', 'GB'];

function spaces(amount) {
  let spaces = '';
  for (let i = 0; i < amount; i++) {
    spaces += ' ';
  }
  return spaces;
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
      res += item + spaces(Math.abs(itemWidth - item.length));
    }
  }
  return res;
}

function prettifySize(size) {
  let type = 0;
  while (size > 1024) {
    size = size / 1024;
    type++;
  }
  return `${size.toFixed(2)} ${sizeTypes[type]}`;
}

function prettifyTime(time) {
  let type = 'ms';
  if (time > 1000) {
    time = time / 1000;
    type = 's';
  }
  return `${time.toFixed(2)} ${type}`;
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
