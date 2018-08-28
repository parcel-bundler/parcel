const Asset = require('../../../src/Asset');

/**
 * Converts the source file into a JS "template"
 */
class HTLAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
  }

  async generate() {
    const code = JSON.stringify(this.contents, null, '  ');

    return [{
      type: 'js',
      value: `function main() { return ${code}; }`,
    }];
  }

}

module.exports = HTLAsset;
