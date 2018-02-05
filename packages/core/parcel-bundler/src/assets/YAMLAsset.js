const Asset = require('../Asset');
const yaml = require('js-yaml');
const serializeObject = require('../utils/serializeObject');

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
      js: serializeObject(this.ast, this.options.minify)
    };
  }
}

module.exports = YAMLAsset;
