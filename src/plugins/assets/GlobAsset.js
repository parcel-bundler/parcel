const glob = require('glob');
const micromatch = require('micromatch');
const path = require('path');

const GlobAsset = {
  type: null,

  async load(state) {
    let regularExpressionSafeName = state.name;
    if (process.platform === 'win32')
      regularExpressionSafeName = regularExpressionSafeName.replace(/\\/g, '/');

    let files = glob.sync(regularExpressionSafeName, {
      strict: true,
      nodir: true
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
        './' + path.relative(path.dirname(state.name), file.normalize('NFC'));
      set(matches, parts, relative);
      state.addDependency(relative);
    }

    return matches;
  },

  parse(contents) {
    return generate(contents);
  },

  generate(contents) {
    return {
      js: 'module.exports = ' + contents + ';'
    };
  }
};

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

module.exports = {
  Asset: {
    'internal/glob': GlobAsset
  }
};
