const Asset = require('../Asset');
const glob = require('glob');
const promisify = require('../utils/promisify');
const globPromise = promisify(glob);
const minimatchCapture = require('minimatch-capture');
const path = require('path');

class GlobAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
    this.matches = {};
  }

  async load() {
    let cwd = path.dirname(this.name);
    let files = await globPromise(this.name, {strict: true});

    for (let [file, subpath] of minimatchCapture.match(files, this.name)) {
      let parts = subpath.split('/');
      let relative = './' + path.relative(path.dirname(this.name), file);
      set(this.matches, parts, relative);
      this.addDependency(relative);
    }
  }

  generate() {
    return {
      js: 'module.exports = ' + generate(this.matches) + ';'
    };
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

    res += `\n${indent}  ${JSON.stringify(key)}: ${generate(matches[key], indent + '  ')}`;
    first = false;
  }

  res += '\n' + indent + '}';
  return res;
}

function set(obj, path, value) {
  for (let i = 0; i < path.length; i++) {
    let part = path[i];

    if (i < path.length - 1 && obj[part] == null) {
      obj[part] = {};
      obj = obj[part];
    } else if (i === path.length - 1) {
      obj[part] = value;
    }
  }
}

module.exports = GlobAsset;
