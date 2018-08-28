const HTMLAsset = require('../../../src/assets/HTMLAsset');

/**
 * Pre-Processes the HTL template and resolves static references.
 */
class HTLPreAsset extends HTMLAsset {
  constructor(name, options) {
    super(name, options);
    this.type = 'htl-js';
  }

  async generate() {
    // we post-process already here, so we can cascade the JS processing
    const generated = await super.generate();
    const processed = await super.postProcess(generated);
    // change type to delegate to 2nd plugin
    processed[0].type = 'htl-preprocessed';
    return processed;
  }

  async postProcess(generated) {
    // adjust type again to final type.
    generated[0].type = 'htl-js';
    return generated;
  }

}

module.exports = HTLPreAsset;
