const Asset = require('../Asset');
const yaml = require('js-yaml');

class YAMLAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
  }

  parse(code) {
    return yaml.safeLoad(code);
  }

  generate() {
    return {
      js: `module.exports=${JSON.stringify(this.ast, false, 2)};`
    };
  }
}

module.exports = YAMLAsset;
