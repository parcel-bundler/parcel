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
    size = Math.round(size / 1024);
    type++;
  }
  return `${size} ${sizeTypes[type]}`;
}

function prettifyTime(time) {
  if (time > 1000) {
    return Math.round(time / 1000) + ' s';
  }
  return time + ' ms';
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
  report += writeRow([nameSize + 5, 10, 10], ['Name', 'Size', 'Time']) + '\n';
  let totalSize = 0;
  let totalTime = 0;
  for (let bundle of bundles) {
    totalSize += bundle.totalSize;
    totalTime += bundle.bundleTime;
    report +=
      writeRow(
        [nameSize + 5, 10, 10],
        [
          path.basename(bundle.name),
          prettifySize(bundle.totalSize),
          prettifyTime(bundle.bundleTime)
        ]
      ) + '\n';
    if (detailed) {
      for (let asset of bundle.assets) {
        report +=
          '--' +
          writeRow(
            [nameSize + 3, 10, 10],
            [
              asset.relativeName,
              prettifySize(asset.bundledSize),
              prettifyTime(asset.buildTime)
            ]
          ) +
          '\n';
      }
    }
  }
  report += '\n';
  report += writeRow(
    [nameSize + 5, 10, 10],
    ['Totals: ', prettifySize(totalSize), prettifyTime(totalTime)]
  );
  return report;
}

module.exports = bundleReport;
