const Asset = require('../Asset');
const micromatch = require('micromatch');
const path = require('path');
const {glob} = require('../utils/glob');

class GlobAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = null; // allows this asset to be included in any type bundle
  }

  async load() {
    let regularExpressionSafeName = this.name;
    if (process.platform === 'win32')
      regularExpressionSafeName = regularExpressionSafeName.replace(/\\/g, '/');

    let files = await glob(regularExpressionSafeName, {
      onlyFiles: true
    });
    let re = micromatch.makeRe(regularExpressionSafeName, {capture: true});
    let matches = {};

    for (let file of files) {
      let match = file.match(re);
      let parts = match
        .slice(1)
        .filter(Boolean)
        .reduce((a, p) => a.concat(p.split('/')), []);
      let relative =
        './' + path.relative(path.dirname(this.name), file.normalize('NFC'));
      set(matches, parts, relative);
      this.addDependency(relative);
    }

    return matches;
  }

  generate() {
    return [
      {
        type: 'js',
        value: 'module.exports = ' + generate(this.contents) + ';'
      }
    ];
  }
}

function generate(matches, indent = '') {
  if (typeof matches === 'string') {
    return `require(${JSON.stringify(matches)})`;
  }

  let res = indent + '{';

  let first = true;
  for (let key in matches) {
    if (!first) {
      res += ',';
    }

    res += `\n${indent}  ${JSON.stringify(key)}: ${generate(
      matches[key],
      indent + '  '
    )}`;
    first = false;
  }

  res += '\n' + indent + '}';
  return res;
}

function set(obj, path, value) {
  for (let i = 0; i < path.length - 1; i++) {
    let part = path[i];

    if (obj[part] == null) {
      obj[part] = {};
    }

    obj = obj[part];
  }

  obj[path[path.length - 1]] = value;
}

module.exports = GlobAsset;
