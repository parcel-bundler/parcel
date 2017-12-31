const JSAsset = require('./JSAsset');
const fs = require('../utils/fs');
const localRequire = require('../utils/localRequire');

class ReasonAsset extends JSAsset {
  async parse() {
    const bsb = await localRequire('bsb-js', this.name);

    // This runs BuckleScript - the Reason to JS compiler.
    // Other Asset types use `localRequire` but the `bsb-js` package already
    // does that internally. This should also take care of error handling in
    // the Reason compilation process.
    if (process.env.NODE_ENV !== 'test') {
      await bsb.runBuild();
    }

    // This is a simplified use-case for Reason - it only loads the recommended
    // BuckleScript configuration to simplify the file processing.
    const outputFile = this.name.replace(/\.(re|ml)$/, '.bs.js');
    const outputContent = await fs.readFile(outputFile);
    this.contents = outputContent.toString();

    // After loading the compiled JS source, use the normal JS behavior.
    return await super.parse(this.contents);
  }
}

module.exports = ReasonAsset;
