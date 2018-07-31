const HTMLAsset = require('../../../src/assets/HTMLAsset');

/**
 * Pre-Processes the HTL template and resolves static references.
 */
class HTLPreAsset extends HTMLAsset {
  constructor(name, options) {
    super(name, options);
    this.type = 'htl-processed';
  }

  async postProcess(generated) {
    const v = await super.postProcess(generated);
    v[0].type = 'htl-processed';
    return v;
  }

  generateBundleName() {
    // use 'js' as extension in order to generate correct file name
    const b = super.generateBundleName();
    return `${b}.js`;
  }
}

module.exports = HTLPreAsset;
