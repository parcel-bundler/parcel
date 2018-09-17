const Asset = require('../Asset');
const yaml = require('js-yaml');
const serializeObject = require('../utils/serializeObject');

class YAMLAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
  }

  parse(code) {
    return yaml.safeLoad(code);
  }

  generate() {
    return serializeObject(
      this.ast,
      this.options.minify && !this.options.scopeHoist
    );
  }
}

module.exports = YAMLAsset;
